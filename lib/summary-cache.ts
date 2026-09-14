import { all, first, run, transaction } from './db';

const PAGE_SIZE = 10000;
export const emptySummary = () => ({ crashes: 0, start: null as string | null, end: null as string | null,
  severe: 0, fatal: 0, cmv: 0, located: 0, deaths: 0, cities: [] as string[] });

export async function cachedSummary() {
  // Read generation and cache together so an activation cannot split this read.
  const rows = await all<{key: string; value: string}>("SELECT key,value FROM settings WHERE key IN ('summary_generation','summary_cache')");
  const values = Object.fromEntries(rows.map(r => [r.key, r.value]));
  const generation = values.summary_generation || '0';
  const cache = values.summary_cache ? JSON.parse(values.summary_cache) : null;
  return { generation, value: cache?.generation === generation ? cache.value : null };
}

// Only the lock-owning worker (or offline tests) builds summaries. Web requests
// read the cache; no visitor request can initiate a full-history scan.
export async function buildSummary(progress: (stage: string) => Promise<void>) {
  const existing = await cachedSummary();
  if (existing.value) return existing.value;
  await run("INSERT INTO settings(key,value) VALUES('summary_generation','0') ON CONFLICT DO NOTHING");
  const { generation } = await cachedSummary();
  const total = emptySummary(), cities = new Set<string>();
  let cursor = '';
  for (;;) {
    await progress(`Summary: counting loaded crashes · ${total.crashes.toLocaleString('en-US')} counted`);
    // Keyset paging bounds each query; the primary key supplies the next page.
    // Group inside PostgreSQL so individual crash rows never leave the database.
    // OFFSET 0 keeps the indexed per-record lookup from being flattened into
    // a hash join that could scan the full crash history for every page.
    const page = await first<any>(`WITH page AS MATERIALIZED (
      SELECT id,batch_id FROM current_crashes WHERE id>? ORDER BY id LIMIT ?
    ), stats AS (
      SELECT c.city,COUNT(*) crashes,MIN(c.date) start,MAX(c.date) "end",
        COUNT(*) FILTER(WHERE c.severity IN (1,4)) severe,
        COUNT(*) FILTER(WHERE c.severity=4) fatal,COALESCE(SUM(c.cmv),0) cmv,
        COUNT(c.latitude) located,COALESCE(SUM(c.deaths),0) deaths
      FROM page p JOIN LATERAL (
        SELECT city,date,severity,cmv,latitude,deaths FROM crashes c
        WHERE c.id=p.id AND c.batch_id=p.batch_id OFFSET 0
      ) c ON true GROUP BY c.city
    ) SELECT (SELECT MAX(id) FROM page) cursor,(SELECT COUNT(*) FROM page) processed,
      (SELECT jsonb_agg(stats) FROM stats) stats`, cursor, PAGE_SIZE);
    for (const row of page.stats || []) {
      for (const key of ['crashes','severe','fatal','cmv','located','deaths'] as const) total[key] += Number(row[key]);
      if (!total.start || row.start < total.start) total.start = row.start;
      if (!total.end || row.end > total.end) total.end = row.end;
      cities.add(row.city);
    }
    if (Number(page.processed) < PAGE_SIZE) break;
    cursor = page.cursor;
  }
  total.cities = [...cities].sort();
  await progress('Summary: saving verified totals');
  await transaction(async () => {
    // Activation updates this same row in its transaction. Never publish a
    // mixed-generation scan if imported revisions changed between pages.
    const current = await first<any>("SELECT value FROM settings WHERE key='summary_generation' FOR UPDATE");
    if (current.value !== generation) throw new Error('Imported data changed while preparing the summary. Retry the scan.');
    await run("INSERT INTO settings(key,value) VALUES('summary_cache',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", JSON.stringify({ generation, value: total }));
    await run("INSERT INTO settings(key,value) VALUES('summary_cached_generation',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", generation);
  });
  return total;
}
