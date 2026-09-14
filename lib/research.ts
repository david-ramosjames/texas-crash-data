import { all, first } from './db';
import { buildSummary, cachedSummary, emptySummary } from './summary-cache';
import { COHORTS, GROUPS, Spec, Evidence, ResultRow } from './contracts';

export const BASE =
  'FROM current_crashes cc JOIN crashes c ON c.id=cc.id AND c.batch_id=cc.batch_id';
const UNIT_FILTERS: Record<string, string> = {
  truck: 'u.body IN (87,106)',
  pedestrian: 'u.kind=4',
  cyclist: 'u.kind=3',
  motorcycle: 'u.body IN (71,90)',
  pickup: 'u.body=30',
  suv: 'u.body=69',
  car: 'u.body IN (100,104)',
};
export function validateSpec(input: unknown): Spec {
  if (!input || typeof input !== 'object')
    throw new Error('A research specification is required.');
  const s = input as Record<string, unknown>;
  const cohort = String(s.cohort || 'all'),
    group = String(s.group || 'city'),
    metric = String(s.metric || 'crashes');
  if (
    !Object.hasOwn(COHORTS, cohort) ||
    !Object.hasOwn(GROUPS, group) ||
    !['crashes', 'severe', 'fatal'].includes(metric)
  )
    throw new Error('Unsupported research category.');
  for (const key of ['start', 'end']) {
    if (
      typeof s[key] !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(s[key] as string) ||
      new Date(s[key] as string).toISOString().slice(0, 10) !== s[key]
    )
      throw new Error('Use valid YYYY-MM-DD research dates.');
  }
  if (String(s.start) > String(s.end))
    throw new Error('The start date must precede the end date.');
  const min = Number(s.min ?? 5),
    limit = Number(s.limit ?? 15);
  if (
    !Number.isInteger(min) ||
    min < 1 ||
    min > 100000 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  )
    throw new Error('Invalid minimum count or result limit.');
  const result = {
    cohort,
    group,
    metric,
    start: s.start,
    end: s.end,
    min,
    limit,
  } as Spec;
  for (const key of ['city', 'county', 'make', 'color'] as const) {
    if (s[key] !== undefined && s[key] !== null && s[key] !== '') {
      if (typeof s[key] !== 'string' || (s[key] as string).length > 100)
        throw new Error('Invalid text filter.');
      result[key] = (s[key] as string).trim();
    }
  }
  const spatial = ['latitude','longitude','radiusMeters'] as const;
  if (spatial.some(k => s[k] !== undefined && s[k] !== null && s[k] !== '')) {
    if (spatial.some(k => typeof s[k] !== 'number' || !Number.isFinite(s[k]))) throw new Error('A radius search requires latitude, longitude, and radius in meters.');
    if (Number(s.latitude)<25 || Number(s.latitude)>37 || Number(s.longitude)<-107 || Number(s.longitude)>-93 || Number(s.radiusMeters)<10 || Number(s.radiusMeters)>50000) throw new Error('Use coordinates in Texas and a radius from 10 to 50,000 meters.');
    result.latitude=Number(s.latitude); result.longitude=Number(s.longitude); result.radiusMeters=Number(s.radiusMeters);
  }
  return result;
}
export function compile(s: Spec) {
  const clauses = ['c.date>=?', 'c.date<=?'];
  const args: unknown[] = [s.start, s.end];
  for (const field of ['city', 'county'] as const) {
    if (s[field]) {
      clauses.push(`UPPER(c.${field})=UPPER(?)`);
      args.push(s[field]);
    }
  }
  if (s.cohort === 'cmv') clauses.push('c.cmv=1');
  const unitClauses: string[] = UNIT_FILTERS[s.cohort] ? [UNIT_FILTERS[s.cohort]] : [];
  for (const field of ['make', 'color'] as const)
    if (s[field]) {
      unitClauses.push(`UPPER(u.${field})=UPPER(?)`);
      args.push(s[field]);
    }
  if(unitClauses.length) clauses.push(`EXISTS (SELECT 1 FROM units u WHERE u.batch_id=c.batch_id AND u.crash_id=c.id AND ${unitClauses.join(' AND ')})`);
  if(s.radiusMeters !== undefined) {
    clauses.push('ST_DWithin(c.location,ST_SetSRID(ST_MakePoint(?::double precision,?::double precision),4326)::geography,?::double precision)');
    args.push(s.longitude,s.latitude,s.radiusMeters);
  }
  const dimensions: Record<string, string> = {
    city: 'c.city',
    county: 'c.county',
    intersection: "c.city || ' · ' || c.intersection",
    road: "c.city || ' · ' || c.road",
    month: 'substr(c.date,1,7)',
    weekday:
      "CASE EXTRACT(DOW FROM c.date::date) WHEN 0 THEN 'Sunday' WHEN 1 THEN 'Monday' WHEN 2 THEN 'Tuesday' WHEN 3 THEN 'Wednesday' WHEN 4 THEN 'Thursday' WHEN 5 THEN 'Friday' ELSE 'Saturday' END",
    hour: "CASE WHEN c.hour IS NULL THEN 'Not recorded' ELSE lpad(c.hour::text,2,'0') || ':00' END",
    weather: 'c.weather',
    light: 'c.light',
    make: 'u.make',
    color: 'u.color',
    body: "COALESCE(body_lookup.description,'Not recorded')",
  };
  const unitGroup = ['make', 'color', 'body'].includes(s.group);
  const join = unitGroup
    ? ' JOIN units u ON u.batch_id=c.batch_id AND u.crash_id=c.id' + (s.group === 'body'
      ? " LEFT JOIN lookups body_lookup ON body_lookup.batch_id=c.batch_id AND body_lookup.column='VEH_BODY_STYL_ID' AND body_lookup.code=CAST(u.body AS TEXT)"
      : '')
    : '';
  const cohortUnits = unitGroup && unitClauses.length ? ` AND ${unitClauses.join(' AND ')}` : '';
  const extra = s.group === 'intersection' ? " AND c.intersection<>''" : '';
  const where = `WHERE ${clauses.join(' AND ')}`;
  const sql = `WITH matched AS (SELECT DISTINCT c.id,c.batch_id,c.severity,c.deaths,c.serious,${dimensions[s.group]} AS label ${BASE}${join} ${where}${extra}${cohortUnits}) SELECT label,COUNT(*) AS crashes,SUM(CASE WHEN severity IN (1,4) THEN 1 ELSE 0 END) AS severe,SUM(CASE WHEN severity=4 THEN 1 ELSE 0 END) AS fatal,SUM(deaths) AS deaths,SUM(serious) AS serious FROM matched GROUP BY label HAVING COUNT(*)>=? ORDER BY ${s.metric} DESC,crashes DESC,label LIMIT ?`;
  const groupArgs = unitGroup ? (['make','color'] as const).filter(k=>s[k]).map(k=>s[k]) : [];
  return { sql, args: [...args, ...groupArgs, s.min, s.limit], where, filterArgs: args };
}
export type QueryProgress = (stage: string) => Promise<void>;
export type ResearchStage = <T>(stage: string, task: () => Promise<T>) => Promise<T>;
const runStage: ResearchStage = async (_stage, task) => task();
const noProgress: QueryProgress = async () => {};
export async function sourceBatches() {
  return all<any>(`SELECT b.id,b.extraction,b.start,b."end",b.status,b.created,b.activated,b.error,
    j.status job_status,j.progress job_progress,j.error job_error
    FROM batches b LEFT JOIN jobs j ON j.batch_id=b.id AND j.kind='import' ORDER BY b.created DESC`);
}
export async function summary(progress: QueryProgress = noProgress, options: { cachedOnly?: boolean } = {}) {
  const stats = options.cachedOnly ? (await cachedSummary()).value : await buildSummary(progress);
  await progress('Summary: checking source coverage');
  const batches = await sourceBatches();
  return {
    ...(stats || emptySummary()),
    ready: !!stats || !batches.some(b => b.status === 'complete'),
    batches,
    completeMonths: completeMonths(
      batches.filter((x) => x.status === 'complete'),
    ),
  };
}
export function covers(
  start: string,
  end: string,
  batches: { start: string; end: string }[],
) {
  let cursor = start;
  for (const b of [...batches].sort((a, b) => a.start.localeCompare(b.start))) {
    if (b.end < cursor) continue;
    if (b.start > cursor) return false;
    cursor = addDay(b.end);
    if (cursor > end) return true;
  }
  return false;
}
export function addDay(date: string) {
  return new Date(Date.parse(date + 'T00:00:00Z') + 86400000)
    .toISOString()
    .slice(0, 10);
}
export function completeMonths(batches: { start: string; end: string }[]) {
  if (!batches.length) return [];
  const lo = batches
    .map((x) => x.start)
    .sort()[0]
    .slice(0, 7);
  const hi = batches
    .map((x) => x.end)
    .sort()
    .at(-1)!
    .slice(0, 7);
  let month = lo;
  const out: string[] = [];
  for (let i = 0; i < 1200 && month <= hi; i++) {
    const [y, m] = month.split('-').map(Number);
    const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    if (covers(month + '-01', end, batches)) out.push(month);
    month = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
  }
  return out;
}
export async function research(spec: Spec, progress: QueryProgress = noProgress, stage: ResearchStage = runStage): Promise<Evidence> {
  const q = compile(spec);
  // Workers bind research to one lock-owning client. Await each query so no
  // queued query outlives a rejection or overlaps the next attempt/transaction.
  await progress('Ranking groups');
  const rows = await stage('ranking', () => all<ResultRow>(q.sql, ...q.args));
  await progress('Counting matching crashes');
  const totals = await stage('totals', () => first<any>(
      `SELECT COUNT(*) total,COUNT(*) FILTER (WHERE c.severity IN (1,4)) severe,COUNT(*) FILTER (WHERE c.severity=4) fatal,COUNT(*) FILTER (WHERE c.latitude IS NULL) unlocated,COUNT(*) FILTER (WHERE c.intersection='') no_intersection ${BASE} ${q.where}`,
      ...q.filterArgs,
    ));
  await progress('Checking source batches');
  const sources = await stage('sources', () => all<any>(
      `SELECT DISTINCT b.id,b.extraction,b.start,b."end" ${BASE} JOIN batches b ON b.id=c.batch_id ${q.where}`,
      ...q.filterArgs,
    ));
  const warnings = [
    'Counts describe reported crashes, not the risk per trip or mile. Traffic exposure is not controlled.',
    'A recorded crash factor is not a legal finding of fault.',
  ];
  if (!covers(spec.start, spec.end, sources))
    warnings.unshift(
      'This extract does not cover every day in the selected period. No full-period trend claim is supported.',
    );
  if (spec.group === 'intersection')
    warnings.push(
      'Intersections use reported street pairs and city, not verified intersection geometry. Spelling variants and frontage roads may split or combine locations; verify before publication.',
    );
  if(spec.radiusMeters !== undefined) warnings.push(`Radius search: ${spec.radiusMeters} meters around ${spec.latitude}, ${spec.longitude}. Crashes without usable coordinates cannot match. A nearby crash is not necessarily associated with one intersection.`);
  if (spec.cohort === 'truck')
    warnings.push(
      'Truck means body style 87 (truck tractor) or 106 (truck). Pickups and SUVs are excluded.',
    );
  if (spec.cohort === 'cmv')
    warnings.push(
      'Commercial motor vehicles include qualifying buses and other vehicles, not only trucks.',
    );
  if (['make', 'color', 'body'].includes(spec.group))
    warnings.push(
      'A multi-vehicle crash can appear in more than one vehicle category. Category counts are not additive and do not measure vehicle safety.',
    );
  if (rows.some((x) => x.crashes < 20))
    warnings.push(
      'Some groups have fewer than 20 crashes. Small counts are unstable; do not infer a persistent pattern.',
    );
  warnings.push(
    'Reporting and later amendments can change these results. Coverage is based on supplied extraction intervals, not a guarantee of reporting completeness.',
  );
  return {
    spec,
    rows: rows.map((x) => ({
      ...x,
      share: totals.total ? x.crashes / totals.total : 0,
    })),
    ...totals,
    excluded: spec.group === 'intersection' ? totals.no_intersection : 0,
    warnings,
    sources,
    generated: new Date().toISOString(),
    engine: 'Validated SQL · distinct crashes',
    sql: q.sql,
    parameters: q.args,
  };
}

export function interpret(
  question: string,
  context: {
    start: string;
    end: string;
    cities: string[];
    completeMonths: string[];
  },
): { spec: Spec; notes: string[] } {
  const q = question.toLowerCase();
  const notes: string[] = [];
  const spec: Spec = {
    cohort: 'all',
    group: 'city',
    metric: 'crashes',
    start: context.start,
    end: context.end,
    min: 5,
    limit: 15,
  };
  if (!q.trim())
    throw new Error('Enter a question or use the research filters.');
  if (/\b(vin|owner|name of|phone|email|address of|specific person)\b/.test(q))
    throw new Error(
      'This studio supports aggregate research, not identifying or contacting crash participants.',
    );
  if (/\b(last month|this month|yesterday|today|last year)\b/.test(q)) {
    const now = new Date();
    if (q.includes('last month')) {
      spec.start = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
      )
        .toISOString()
        .slice(0, 10);
      spec.end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0))
        .toISOString()
        .slice(0, 10);
    } else if (q.includes('last year')) {
      spec.start = `${now.getUTCFullYear() - 1}-01-01`;
      spec.end = `${now.getUTCFullYear() - 1}-12-31`;
    } else
      throw new Error(
        'Choose exact dates in the research filters for this question.',
      );
    if (spec.start > context.end || spec.end < context.start)
      throw new Error(
        `Your data covers ${context.start} to ${context.end}, not ${spec.start} to ${spec.end}. Upload that period or ask about the available extract.`,
      );
  } else if (/latest (complete|full) month/.test(q)) {
    const m = context.completeMonths.at(-1);
    if (!m)
      throw new Error(
        'No full calendar month is covered yet. Use the available extract or upload the missing dates.',
      );
    spec.start = m + '-01';
    const [y, n] = m.split('-').map(Number);
    spec.end = new Date(Date.UTC(y, n, 0)).toISOString().slice(0, 10);
  } else {
    const dates = q.match(/\d{4}-\d{2}-\d{2}/g);
    if (dates?.length) {
      spec.start = dates[0];
      spec.end = dates[1] || dates[0];
    } else {
      const y = q.match(/\b(20\d{2})\b/);
      const names = [
        'january',
        'february',
        'march',
        'april',
        'may',
        'june',
        'july',
        'august',
        'september',
        'october',
        'november',
        'december',
      ];
      const mi = names.findIndex((n) => q.includes(n));
      if (mi >= 0) {
        const year = y ? Number(y[1]) : Number(context.end.slice(0, 4));
        spec.start = `${year}-${String(mi + 1).padStart(2, '0')}-01`;
        spec.end = new Date(Date.UTC(year, mi + 1, 0))
          .toISOString()
          .slice(0, 10);
      } else if (y) {
        spec.start = y[1] + '-01-01';
        spec.end = y[1] + '-12-31';
      }
    }
  }
  if (/\b(cmv|commercial)\b/.test(q)) spec.cohort = 'cmv';
  else if (/pick.?up/.test(q)) spec.cohort = 'pickup';
  else if (/truck/.test(q)) spec.cohort = 'truck';
  else if (/pedestrian|walking/.test(q)) spec.cohort = 'pedestrian';
  else if (/cyclist|bicycle|bike/.test(q)) spec.cohort = 'cyclist';
  else if (/motorcycle/.test(q)) spec.cohort = 'motorcycle';
  else if (/\bsuv/.test(q)) spec.cohort = 'suv';
  else if (/\bcars?\b/.test(q)) spec.cohort = 'car';
  if (/fatal|deadliest|death/.test(q)) spec.metric = 'fatal';
  else if (/serious|severe|dangerous/.test(q)) spec.metric = 'severe';
  if (/dangerous|risk|safest/.test(q))
    notes.push(
      'Interpreted as recorded fatal/serious-injury crash counts, not exposure-adjusted danger.',
    );
  if (/intersection/.test(q)) spec.group = 'intersection';
  else if (/road|corridor|highway|street/.test(q)) spec.group = 'road';
  else if (/count(?:y|ies)/.test(q)) spec.group = 'county';
  else if (/day of (the )?week|weekday|weekend/.test(q)) spec.group = 'weekday';
  else if (/hour|time of day|night/.test(q)) spec.group = 'hour';
  else if (/weather|rain/.test(q)) spec.group = 'weather';
  else if (/light|dark/.test(q)) spec.group = 'light';
  else if (/brand|make|manufacturer/.test(q)) spec.group = 'make';
  else if (/color|colour/.test(q)) spec.group = 'color';
  else if (/vehicle type|body style/.test(q)) spec.group = 'body';
  else if (/monthly|by month|trend/.test(q)) spec.group = 'month';
  const cities = context.cities
    .filter(
      (c) =>
        !['UNKNOWN', 'NOT REPORTED', 'OUTSIDE CITY LIMITS'].includes(
          c.toUpperCase(),
        ),
    )
    .sort((a, b) => b.length - a.length);
  const words = ' ' + q.replace(/[^a-z0-9 '\-]/g, ' ') + ' ';
  spec.city = cities.find((c) => words.includes(' ' + c.toLowerCase() + ' '));
  const count = q.match(/top (\d+)/);
  if (count) spec.limit = Math.min(100, Number(count[1]));
  if (
    /\b(increase|decrease|change|compare|versus|vs|why|cause|alcohol|drunk|speeding|school|injury|injuries|red|ford|chevrolet|toyota)\b/.test(
      q,
    ) &&
    !/serious.injur/.test(q)
  )
    notes.push(
      'This built-in interpreter supports the visible filters only. Check the interpretation below; unrepresented conditions have not been applied. For more nuanced phrasing, connect AI or adjust the filters.',
    );
  return { spec: validateSpec(spec), notes };
}
