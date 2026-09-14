// Incremental RFC 4180 parser; identifiers remain text, including leading zeros.
export class CSVParser {
  constructor(private delimiter = ',') {}
  private cell = '';
  private row: string[] = [];
  private quoted = false;
  private pendingQuote = false;
  private skipLF = false;
  feed(text: string, final = false): string[][] {
    const out: string[][] = [];
    for (const ch of text) {
      if (this.skipLF) {
        this.skipLF = false;
        if (ch === '\n') continue;
      }
      if (this.pendingQuote) {
        this.pendingQuote = false;
        if (ch === '"') {
          this.cell += '"';
          continue;
        }
        this.quoted = false;
        if (ch !== this.delimiter && ch !== '\r' && ch !== '\n')
          throw new Error('Unexpected character after closing CSV quote.');
      }
      if (this.quoted) {
        if (ch === '"') this.pendingQuote = true;
        else this.cell += ch;
        continue;
      }
      if (ch === '"') {
        if (this.cell) throw new Error('Unexpected quote in CSV field.');
        this.quoted = true;
      } else if (ch === this.delimiter) {
        this.row.push(this.cell);
        this.cell = '';
      } else if (ch === '\r' || ch === '\n') {
        this.row.push(this.cell);
        if (this.row.some((x) => x !== '')) out.push(this.row);
        this.cell = '';
        this.row = [];
        this.skipLF = ch === '\r';
      } else this.cell += ch;
    }
    if (final) {
      if (this.quoted && !this.pendingQuote)
        throw new Error('Unclosed CSV quote.');
      if (this.cell || this.row.length) {
        this.row.push(this.cell);
        out.push(this.row);
      }
      this.cell = '';
      this.row = [];
    }
    return out;
  }
}
export async function* readCSV(file: { stream(): ReadableStream<Uint8Array> }) {
  const reader = file.stream().getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const parser = new CSVParser();
  let headers: string[] | undefined;
  try {
    while (true) {
      const { value, done } = await reader.read();
      const rows = parser.feed(decoder.decode(value, { stream: !done }), done);
      for (const row of rows) {
        if (!headers) {
          headers = row.map((x, i) =>
            (i === 0 ? x.replace(/^\uFEFF/, '') : x).trim(),
          );
          if (new Set(headers).size !== headers.length)
            throw new Error('Duplicate CSV column names.');
          continue;
        }
        if (row.length !== headers.length)
          throw new Error(
            `CSV row has ${row.length} fields; expected ${headers.length}.`,
          );
        yield Object.fromEntries(headers.map((h, i) => [h, row[i]])) as Record<
          string,
          string
        >;
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}
export function identify(name: string) {
  const m = name.match(
    /^extract_public_(\d+)_(\d{14})_(crash|unit|lookup|primaryperson|person|charges|damages|endorsements|restrictions)_(\d{8})-(\d{8})Texas\.csv$/i,
  );
  if (!m)
    throw new Error(
      `Unrecognized TxDOT filename: ${name}. Upload the original CSV files without renaming.`,
    );
  const date = (s: string) =>
    `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  for (const value of [date(m[4]),date(m[5]),date(m[2].slice(0,8))]) {
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10)!==value) throw new Error('Invalid date in TxDOT filename.');
  }
  return {
    id: `txdot-${m[1]}-${m[2]}-${m[4]}-${m[5]}`,
    schema: m[1],
    extraction: m[2],
    kind: m[3].toLowerCase(),
    start: date(m[4]),
    end: date(m[5]),
  };
}
export type Lookup = Map<string, string>;
export function parseCrashHour(value: string): number | null {
  const s=value.trim().toUpperCase();
  if(!s || /^(UNKNOWN|NOT REPORTED|NOT RECORDED|99:99|9999)$/.test(s)) return null;
  const m=s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/);
  if(m) {
    let h=Number(m[1]);
    if(Number(m[2])>59 || Number(m[3] || 0)>59 || (m[4] ? h<1 || h>12 : h>23)) throw new Error('Invalid Crash_Time format; original preserved.');
    if(m[4]) h=h%12+(m[4]==='PM'?12:0);
    return h;
  }
  if(/^\d{3,4}$/.test(s)) {
    const h=Number(s.slice(0,-2)), minutes=Number(s.slice(-2));
    if(h<24 && minutes<60) return h;
  }
  throw new Error('Invalid Crash_Time format; original preserved.');
}
export function decode(map: Lookup, column: string, value: string) {
  return (
    map.get(`${column}|${value}`) ||
    (value ? `Unknown (${value})` : 'Not recorded')
  );
}
export function normalize(
  row: Record<string, string>,
  kind: string,
  map: Lookup,
  legacyTime = false,
) {
  const n = (key: string) =>
    row[key]?.trim() !== '' && Number.isFinite(Number(row[key]))
      ? Number(row[key])
      : null;
  const text = (key: string) => row[key]?.trim() || '';
  const d = (col: string, key = col) => decode(map, col, text(key));
  if (kind === 'lookup')
    return {
      column: text('ColumnName'),
      code: text('ID'),
      description: text('Description'),
    };
  if (!text('Crash_ID')) throw new Error('Missing Crash_ID.');
  if (kind === 'crash') {
    let date = text('Crash_Date');
    if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(date)) {
      const [m, d, y] = date.split(/[\/ ]/);
      date = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    date = date.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0,10)!==date)
      throw new Error(`Invalid crash date: ${date}`);
    const road =
      [text('Rpt_Street_Pfx'), text('Rpt_Street_Name'), text('Rpt_Street_Sfx')]
        .filter(Boolean)
        .join(' ') ||
      text('Street_Name') ||
      [text('Rpt_Rdwy_Sys_ID'), text('Rpt_Hwy_Num')]
        .filter(Boolean)
        .join(' ') ||
      'Not recorded';
    const secondary =
      [
        text('Rpt_Sec_Street_Pfx'),
        text('Rpt_Sec_Street_Name'),
        text('Rpt_Sec_Street_Sfx'),
      ]
        .filter(Boolean)
        .join(' ') || text('Street_Name_2');
    const intersection =
      text('At_Intrsct_Fl') === 'Y' && secondary
        ? [road, secondary]
            .map((x) => x.toUpperCase().replace(/\s+/g, ' ').trim())
            .sort()
            .join(' & ')
        : '';
    const lat = n('Latitude'),
      lon = n('Longitude');
    const located =
      lat !== null &&
      lon !== null &&
      lat >= 25 &&
      lat <= 37 &&
      lon >= -107 &&
      lon <= -93;
    const time = text('Crash_Time');
    const hour = time.includes(':')
      ? Number(time.split(':')[0])
      : Number(time.padStart(4, '0').slice(0, 2));
    return {
      id: text('Crash_ID'),
      date,
      hour: legacyTime ? (time && hour >= 0 && hour < 24 ? hour : null) : parseCrashHour(time),
      city: d('CITY_ID', 'City_ID'),
      county: d('CNTY_ID', 'Cnty_ID'),
      road: road.toUpperCase(),
      intersection,
      severity: n('Crash_Sev_ID'),
      cmv: text('Cmv_Involv_Fl') === 'Y' ? 1 : 0,
      deaths: n('Death_Cnt') || 0,
      serious: n('Sus_Serious_Injry_Cnt') || 0,
      injuries: n('Tot_Injry_Cnt') || 0,
      latitude: located ? lat : null,
      longitude: located ? lon : null,
      weather: d('WTHR_COND_ID', 'Wthr_Cond_ID'),
      light: d('LIGHT_COND_ID', 'Light_Cond_ID'),
      rural: text('Rural_Fl'),
      speed: n('Crash_Speed_Limit'),
      intersection_flag: text('At_Intrsct_Fl') === 'Y' ? 1 : 0,
    };
  }
  if (kind === 'unit') {
    if (!text('Unit_Nbr')) throw new Error('Missing Unit_Nbr.');
    return {
      crash_id: text('Crash_ID'),
      number: text('Unit_Nbr'),
      kind: n('Unit_Desc_ID'),
      body: n('Veh_Body_Styl_ID'),
      make: d('VEH_MAKE_ID', 'Veh_Make_ID'),
      model: d('VEH_MOD_ID', 'Veh_Mod_ID'),
      color: d('VEH_COLOR_ID', 'Veh_Color_ID'),
      year: n('Veh_Mod_Year'),
      cmv: text('Veh_Cmv_Fl') === 'Y' ? 1 : 0,
      factor: d('CONTRIB_FACTR_ID', 'Contrib_Factr_1_ID'),
    };
  }
  return { crash_id: text('Crash_ID') };
}
