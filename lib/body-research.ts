import { all, first } from "./db";
import { compile, type QueryProgress, type ResearchStage } from "./research";
import type { ResultRow, Spec } from "./contracts";

const DEFAULT_PAGE_SIZE = 2000;
type Totals = {
  total: number;
  severe: number;
  fatal: number;
  unlocated: number;
  no_intersection: number;
};
type Page = {
  next: string | null;
  scanned: number;
  rows: ResultRow[];
  totals: Totals;
  sources: string[];
};
const totalsKeys = ["total", "severe", "fatal", "unlocated", "no_intersection"] as const;
const rowKeys = ["crashes", "severe", "fatal", "deaths", "serious"] as const;
function add(left: number, right: number) {
  const result = left + Number(right);
  if (!Number.isSafeInteger(result) || result < 0)
    throw new Error("Research count exceeds the supported integer range.");
  return result;
}

// One page owns whole crash IDs, including all their matching vehicles. A crash
// cannot cross pages, so summing per-label distinct counts is exact. Pages keep
// ALL labels: applying min/limit here would silently corrupt the final ranking.
export async function bodyAnalysis(
  spec: Spec,
  progress: QueryProgress,
  stage: ResearchStage,
  pageSize = DEFAULT_PAGE_SIZE,
) {
  if (
    spec.group !== "body" ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > DEFAULT_PAGE_SIZE
  )
    throw new Error("Invalid body analysis page request.");
  const q = compile(spec, true);
  const generation = async () =>
    (await first<{ value: string }>("SELECT value FROM settings WHERE key='summary_generation'"))
      ?.value || "0";
  const startedGeneration = await generation();
  const groups = new Map<string, ResultRow>(),
    sourceIds = new Set<string>();
  const totals: Totals = { total: 0, severe: 0, fatal: 0, unlocated: 0, no_intersection: 0 };
  let after: string | null = null,
    scanned = 0;
  for (let pageNumber = 1; ; pageNumber++) {
    await progress(
      `Body types · page ${pageNumber} · ${scanned.toLocaleString("en-US")} crashes checked`,
    );
    const page: Page = await stage(`body-page-v1:${pageSize}:${pageNumber}`, async () => {
      // LIMIT is applied before joining vehicles. OFFSET 0 keeps these lateral
      // reads parameterized by the existing primary keys instead of scanning
      // every historical crash/vehicle version for each page.
      const result = await first<Page>(
        `WITH crash_page AS MATERIALIZED (
        SELECT c.* FROM (
          SELECT id,batch_id FROM current_crashes ${after === null ? "" : "WHERE id>?"} ORDER BY id LIMIT ?
        ) cc JOIN LATERAL (
          SELECT * FROM crashes c WHERE c.batch_id=cc.batch_id AND c.id=cc.id OFFSET 0
        ) c ON true
      ), filtered AS MATERIALIZED (SELECT c.* FROM crash_page c ${q.where}),
      ranked AS (${q.aggregateSql})
      SELECT (SELECT MAX(id) FROM crash_page) AS next,
        (SELECT COUNT(*) FROM crash_page) AS scanned,
        COALESCE((SELECT jsonb_agg(r) FROM ranked r),'[]'::jsonb) AS rows,
        (SELECT jsonb_build_object('total',COUNT(*),
          'severe',COUNT(*) FILTER (WHERE severity IN (1,4)),
          'fatal',COUNT(*) FILTER (WHERE severity=4),
          'unlocated',COUNT(*) FILTER (WHERE latitude IS NULL),
          'no_intersection',COUNT(*) FILTER (WHERE intersection='')) FROM filtered) AS totals,
        COALESCE((SELECT jsonb_agg(DISTINCT batch_id) FROM filtered),'[]'::jsonb) AS sources`,
        ...(after === null ? [] : [after]),
        pageSize,
        ...q.filterArgs,
        ...q.aggregateArgs,
      );
      if (!result) throw new Error("Body analysis page did not return a result.");
      return result;
    });
    // Rebuild from saved pages on resume, adding every page exactly once. Never
    // reset the overall discovery version: completed questions remain reusable.
    for (const row of page.rows) {
      const accumulated = groups.get(row.label) || {
        label: row.label,
        crashes: 0,
        severe: 0,
        fatal: 0,
        deaths: 0,
        serious: 0,
      };
      for (const key of rowKeys) accumulated[key] = add(accumulated[key], row[key]);
      groups.set(row.label, accumulated);
    }
    for (const key of totalsKeys) totals[key] = add(totals[key], page.totals[key]);
    for (const id of page.sources) sourceIds.add(id);
    scanned += Number(page.scanned);
    if (Number(page.scanned) < pageSize) break;
    if (page.next === null || page.next === after)
      throw new Error("Body analysis cursor did not advance.");
    after = page.next;
  }
  await progress("Body types · combining all pages into final ranking");
  // Let PostgreSQL apply the same collation and tie-breaks as the original SQL.
  const rows = await stage("body-final-ranking-v1", () =>
    all<ResultRow>(
      `SELECT label,crashes,severe,fatal,deaths,serious FROM jsonb_to_recordset(?::jsonb)
      AS r(label text,crashes bigint,severe bigint,fatal bigint,deaths bigint,serious bigint)
      WHERE crashes>=? ORDER BY ${spec.metric} DESC,crashes DESC,label LIMIT ?`,
      JSON.stringify([...groups.values()]),
      spec.min,
      spec.limit,
    ),
  );
  const sources = await stage("body-sources-v1", () =>
    all<{ id: string; extraction: string; start: string; end: string }>(
      'SELECT id,extraction,start,"end" FROM batches WHERE id=ANY(?::text[]) ORDER BY id',
      [...sourceIds],
    ),
  );
  if ((await generation()) !== startedGeneration)
    throw new Error(
      "Imported data changed during body analysis. Retry against the current data; no mixed-version result was saved.",
    );
  return { rows, totals, sources };
}
