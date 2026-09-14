import type { Evidence, Spec } from "./contracts";
export const TIME_VERSION = 2;
export function usesHours(s: Spec) {
  return s.group === "hour" || s.hourFrom !== undefined || s.hourThrough !== undefined;
}
export function needsTimeRefresh(e: Evidence) {
  return usesHours(e.spec) && e.timeVersion !== TIME_VERSION;
}
export function comparisonRow(e: Evidence, label: string) {
  let previousLabel = label;
  if (
    e.spec.group === "month" &&
    e.comparison &&
    (e.spec.compare === "year_over_year" || e.comparison.kind === "Year over year")
  )
    previousLabel = String(Number(label.slice(0, 4)) - 1) + label.slice(4);
  return e.comparison?.rows.find((r) => r.label === previousLabel);
}
export function usableLocation(label: string) {
  return !label
    .split(/·|&/)
    .some((part) =>
      /^(unknown(?:\s*\(.*\))?|not (?:reported|recorded)|n\/?a|none)?$/i.test(part.trim()),
    );
}
export function periodLabel(e: Evidence) {
  const { start, end } = e.spec;
  if (e.comparison)
    return `${e.comparison.kind || "Comparison"} · ${start}–${end} vs ${e.comparison.start}–${e.comparison.end}`;
  if (start.slice(0, 4) === end.slice(0, 4) && start.endsWith("-01-01") && end.endsWith("-12-31"))
    return `Annual · ${start.slice(0, 4)}`;
  if (start.slice(0, 7) === end.slice(0, 7)) return `Month · ${start}–${end}`;
  return `Period · ${start}–${end}`;
}
