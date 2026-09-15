import { COHORTS, GROUPS, number, titleCase, type Evidence } from "./contracts";
import { comparisonRow } from "./research-quality";

export const APPENDIX = "## Verified statistics";
export const COVER_CAPTION =
  "AI-generated illustration. Not a photograph of an actual crash or a verified location.";
export const BUILTIN_COVER = "texas-truck-cover-v1";
export const BUILTIN_COVER_ALT =
  "Illustration of an unbranded semi-truck traveling on a generic urban freeway in daylight.";
export const metricLabel = (metric: string) =>
  metric === "severe"
    ? "fatal or suspected serious-injury crashes"
    : metric === "fatal"
      ? "fatal crashes"
      : "reported crashes";
export function headlineIdeas(e: Evidence) {
  const place = e.spec.city ? titleCase(e.spec.city) : "Texas";
  const subject =
    e.spec.cohort === "truck"
      ? "truck crashes"
      : e.spec.cohort === "all"
        ? "reported crashes"
        : `${COHORTS[e.spec.cohort].toLowerCase()} crashes`;
  return [
    `${place} ${subject}: a closer look at the ${GROUPS[e.spec.group].toLowerCase()} rankings`,
    `What the supplied records show about ${subject} in ${place}`,
    `${place} ${subject}: the reported pattern and its limits`,
  ];
}
export function editorialRows(e: Evidence) {
  return e.comparison?.focusLabel
    ? e.rows.filter((r) => r.label === e.comparison!.focusLabel)
    : e.rows;
}

// A review heuristic, NOT a road canonicalizer. Preserve directional prefixes,
// cities, every source label, and the original counts. Never merge on this key.
export function roadNameWarnings(e: Evidence): string[] {
  if (e.spec.group !== "road") return [];
  const groups = new Map<string, string[]>();
  for (const row of e.rows) {
    const key = row.label
      .toUpperCase()
      .replace(/\bFREEWAY\b/g, "FWY")
      .replace(/\bHIGHWAY\b/g, "HWY")
      .replace(/[^A-Z0-9]/g, "");
    const labels = groups.get(key) || [];
    if (!labels.includes(row.label)) labels.push(row.label);
    groups.set(key, labels);
  }
  return [...groups.values()]
    .filter((g) => g.length > 1)
    .map(
      (g) =>
        `Possible road-name variants: ${g.map(titleCase).join(" / ")}. Review their geography before combining them. They remain separate in this analysis.`,
    );
}
export function editorialMethods(e: Evidence): string[] {
  return [
    ...new Set([
      `Period: ${e.spec.start} through ${e.spec.end}. Cohort: ${COHORTS[e.spec.cohort]}. Grouping: ${GROUPS[e.spec.group]}. Ranked by ${metricLabel(e.spec.metric)}. Minimum group size: ${e.spec.min}; requested result limit: ${e.spec.limit}.`,
      "Counts are distinct reported crashes within each group, not risk per trip or mile. Traffic exposure is not controlled. A crash involving several vehicle types can appear in more than one vehicle group; group counts must not be summed as a unique crash total.",
      "Fatal crashes count crash events; deaths count people. Fatal or suspected serious-injury crashes count events; suspected serious injuries count people. These measures are not interchangeable.",
      ...(e.spec.cohort === "truck"
        ? [
            "Truck means TxDOT body style 87 (truck tractor) or 106 (truck). Pickups and SUVs are excluded.",
          ]
        : []),
      ...(e.spec.group === "intersection"
        ? [
            `${number(e.excluded)} matching crashes were excluded from intersection grouping because no usable reported intersection pair was recorded.`,
          ]
        : []),
      `${number(e.unlocated)} matching crashes have no usable mapped coordinates. Missing coordinates alone do not exclude crashes from an analysis without a radius filter.`,
      ...(e.spec.group === "road"
        ? [
            "Roads are grouped by reported names, not verified continuous corridors. Spelling and directional variants may split a road across groups. This review checks only the returned labels and does not establish that all aliases have been found.",
          ]
        : []),
      ...roadNameWarnings(e),
      ...e.warnings,
      ...(e.comparison
        ? [`Comparison: ${e.comparison.start} through ${e.comparison.end}. ${e.comparison.caveat}`]
        : []),
      "The extract does not establish causation, legal fault, or statistical significance. Supplied extraction intervals do not guarantee reporting completeness; later reports and amendments can change results.",
      `Source: Texas Department of Transportation public crash extract. ${e.sources.length} source batches. Evidence snapshot: ${e.generated.slice(0, 10)}. The saved query and source batch IDs accompany exports.`,
    ]),
  ];
}
export function narrativeOnly(body: string) {
  return body.split(APPENDIX)[0].trim();
}
export function assertEditorialReady(body: string) {
  for (const match of body.matchAll(
    /\b[\d,]+\s+(?:(fatal\s+or)\s+)?(?:suspected\s+)?serious[- ]injury\s+crashes\b/gi,
  )) {
    if (!match[1])
      throw new Error(
        "Review the serious-injury wording before approval: the serious-injury total counts people, not crashes. Use the verified fatal-or-suspected-serious-injury crash count, or label the number as people with suspected serious injuries.",
      );
  }
}
export function composeEditorial(body: string, e: Evidence) {
  const rows = editorialRows(e);
  const statistics = rows
    .map(
      (r, i) =>
        `${i + 1}. ${titleCase(r.label)}: ${number(r.crashes)} reported crashes; ${number(r.severe)} fatal or suspected serious-injury crashes; ${number(r.fatal)} fatal crashes; ${number(r.deaths)} deaths; ${number(r.serious)} people with suspected serious injuries.`,
    )
    .join("\n");
  return `${narrativeOnly(body)}\n\n${APPENDIX}\n\n${number(e.total)} matching crashes in the full filtered cohort. The following ${rows.length} returned groups are not necessarily the whole cohort.\n\n${statistics}\n\n## Methods, definitions and limitations\n\n${editorialMethods(
    e,
  )
    .map((x) => "- " + x)
    .join("\n")}`;
}
export function editorialFacts(e: Evidence) {
  const rows = editorialRows(e);
  const facts: Record<string, string> = {
    period: `${e.spec.start} through ${e.spec.end}`,
    scope: `The supplied TxDOT extract contains ${number(e.total)} matching ${e.spec.cohort === "all" ? "reported" : COHORTS[e.spec.cohort].toLowerCase()} crashes${e.spec.city ? " in " + titleCase(e.spec.city) : " in Texas"} from ${e.spec.start} through ${e.spec.end}.`,
    ranking: `This analysis ranks ${rows.length} returned ${GROUPS[e.spec.group].toLowerCase()} groups by ${metricLabel(e.spec.metric)}.`,
  };
  rows.forEach((r, i) => {
    const key = `row${i + 1}`;
    facts[key] =
      `${titleCase(r.label)} recorded ${number(r.crashes)} crashes, including ${number(r.severe)} fatal or suspected serious-injury crashes and ${number(r.fatal)} fatal crashes.`;
    facts[key + "_people"] =
      `${titleCase(r.label)} recorded ${number(r.deaths)} deaths and ${number(r.serious)} people with suspected serious injuries.`;
    // Share is meaningful per crash, but summing shares across vehicle groups is not.
    if (e.total > 0)
      facts[key + "_share"] =
        `${titleCase(r.label)} accounts for ${((100 * r.crashes) / e.total).toFixed(1)}% of matching crashes in the full filtered cohort (not just the returned groups).`;
    const previous = comparisonRow(e, r.label);
    if (previous && e.comparison) {
      const diff = r.crashes - previous.crashes;
      facts[key + "_comparison"] =
        `${titleCase(r.label)}: ${number(r.crashes)} reported crashes in ${e.spec.start} through ${e.spec.end}, versus ${number(previous.crashes)} in ${e.comparison.start} through ${e.comparison.end}; a change of ${diff > 0 ? "+" : ""}${diff}${previous.crashes > 0 ? ` (${diff > 0 ? "+" : ""}${((100 * diff) / previous.crashes).toFixed(1)}%)` : " (percentage change is undefined from a zero baseline)"}. ${e.comparison.caveat}`;
    }
  });
  return facts;
}
// Numbers are supplied by code as complete, correctly labeled factual sentences.
// This catches invented numeric claims, but is not a substitute for human review
// of the surrounding language, causal assertions, or publication suitability.
export function expandEditorial(text: string, e: Evidence) {
  if (typeof text !== "string" || text.length > 45000)
    throw new Error("The article response was invalid. Your saved draft was not changed.");
  const facts = editorialFacts(e);
  const prose = text.replace(/\[\[fact:([a-z0-9_]+)\]\]/g, (_, id) => {
    if (!Object.hasOwn(facts, id))
      throw new Error(
        "The article used an unknown evidence fact. Your saved draft was not changed.",
      );
    return "";
  });
  if (/\d|\[\[|\]\]|<\/?[a-z]/i.test(prose))
    throw new Error(
      "The article introduced unverified numbers or markup. Your saved draft was not changed; try generating again.",
    );
  if (!text.includes("[[fact:scope]]") || !text.includes("[[fact:row1]]"))
    throw new Error("The article omitted its core evidence. Your saved draft was not changed.");
  return composeEditorial(
    text.replace(/\[\[fact:([a-z0-9_]+)\]\]/g, (_, id) => facts[id]),
    e,
  );
}
export function starterArticle(e: Evidence, channel: string) {
  const f = editorialFacts(e),
    lead = editorialRows(e)[0];
  if (!lead) return composeEditorial(f.scope, e);
  const opening = `${f.scope}\n\n${f.row1} ${f.row1_share || ""}`;
  const rest =
    channel === "social"
      ? ""
      : `\n\n## A closer look at the reported pattern\n\n${f.row2 || ""} ${f.ranking} The figures describe where reported crashes appear in this extract; they do not explain what caused them.\n\n## Frequency and consequences tell different stories\n\n${f.row1_people} A high crash count and the number of people hurt answer different questions. Neither should be used as a substitute for the other.\n\n${f.row1_comparison ? "## Comparing the available periods\n\n" + f.row1_comparison + "\n\n" : ""}## What to take away\n\n${e.spec.group === "road" ? "Treat these as reported road-name groups, not a definitive ranking of complete corridors. Review name variants before describing an entire highway." : "These results describe the selected groups and period, not every setting or every year."} Counts alone cannot tell a reader the risk of an individual trip. That would require an appropriate traffic-exposure denominator. ${!e.comparison ? "No year-over-year comparison was run for this snapshot; trends should be researched separately before they are described." : ""}`;
  return composeEditorial(opening + rest, e);
}
