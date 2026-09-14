import { CSVParser } from "./csv";
import { interpret, summary } from "./research";
import { saveIdea } from "./ideas";
export function plannerRows(text: string) {
  if (typeof text !== "string" || text.length > 750000)
    throw new Error("Use a Keyword Planner export smaller than 750 KB.");
  const clean = text.replace(/^\uFEFF/, "");
  const headerLine = clean.split(/\r?\n/).find((l) => /avg\. monthly searches/i.test(l));
  if (!headerLine)
    throw new Error(
      "Expected the English Keyword Planner export with Keyword and Avg. monthly searches columns.",
    );
  const delimiter = headerLine.includes("\t") ? "\t" : ",";
  const rows = new CSVParser(delimiter).feed(clean, true);
  const index = rows.findIndex(
    (r) =>
      r.some((v) => v.trim().toLowerCase() === "keyword") &&
      r.some((v) => v.trim().toLowerCase() === "avg. monthly searches"),
  );
  if (index < 0) throw new Error("Keyword Planner column headers were not found.");
  const headers = rows[index].map((v) => v.trim().toLowerCase()),
    keyword = headers.indexOf("keyword"),
    volume = headers.indexOf("avg. monthly searches");
  const records = rows.slice(index + 1).filter((r) => r[keyword]?.trim());
  if (records.length > 500) throw new Error("Import up to 500 selected keywords at a time.");
  return records.map((r) => {
    const question = r[keyword].trim(),
      estimate = (r[volume] || "").trim();
    if (question.length > 400 || estimate.length > 80)
      throw new Error("Keyword or estimate is too long.");
    if (estimate && !/^(?:[\d,.\sKkMm+–—\-]+|--|N\/A)$/i.test(estimate))
      throw new Error(
        "Unrecognized search estimate. Preserve the original numeric value or range.",
      );
    return { question, estimate: estimate || "Not available" };
  });
}
export async function importPlanner(text: string, context: string) {
  if (typeof context !== "string" || context.trim().length < 10 || context.length > 500)
    throw new Error(
      "Record the Planner location, language, network and date range before importing.",
    );
  const records = plannerRows(text),
    s = await summary(undefined, { cachedOnly: true });
  if (!s.crashes) throw new Error("Import crash data first.");
  let accepted = 0,
    skipped = 0;
  for (const r of records) {
    // This dataset cannot answer legal-service, compensation, live-incident or
    // participant-identification intents. Never turn them into fake research.
    if (
      /\b(lawyer|attorney|settlement|compensation|insurance|today|yesterday|near me|vin|phone|name|fault)\b/i.test(
        r.question,
      )
    ) {
      skipped++;
      continue;
    }
    if (
      /drunk|drinking|distract|texting|alcohol|speeding|teen|age|gender|male|female|seat.?belt|cause|risk|rate|per capita|safest/i.test(
        r.question,
      )
    ) {
      skipped++;
      continue;
    }
    let parsed;
    try {
      parsed = interpret(r.question, s);
    } catch {
      skipped++;
      continue;
    }
    await saveIdea(
      r.question,
      parsed.spec,
      "Google Keyword Planner export",
      `Keyword-informed candidate. Review the mapped filters before approval. ${parsed.notes.join(" ")}`,
      `Avg. monthly searches: ${r.estimate}. Settings supplied with export: ${context.trim()}. Imported ${new Date().toISOString().slice(0, 10)}. Estimates may include close variants; not LLM prompt volume.`,
    );
    accepted++;
  }
  return {
    accepted,
    skipped,
    note: "Repeated question-and-filter pairs are kept once. Unsupported intents were skipped. No research queries were run.",
  };
}
