import { createHash } from "node:crypto";
import { all, first, run, transaction, runtime } from "./db";
import { validateSpec, research, summary } from "./research";
import { discoveryCheckpoints } from "./discovery-checkpoints";
import { aiPropose } from "./ai";
import { usableLocation } from "./research-quality";
import { keywordSeeds, keywordSnapshot } from "./keyword-seeds";
import { requestFailure } from "./errors";

export async function saveIdea(
  question: string,
  input: unknown,
  source: string,
  rationale: string,
  demand?: string,
) {
  if (typeof question !== "string" || !question.trim() || question.length > 500)
    throw new Error("Use a question of 1–500 characters.");
  const spec = validateSpec(input);
  const signature = createHash("sha256")
    .update(
      JSON.stringify({
        question: question.trim().toLowerCase(),
        spec: Object.fromEntries(Object.entries(spec).sort(([a], [b]) => a.localeCompare(b))),
      }),
    )
    .digest("hex");
  await run(
    `INSERT INTO research_ideas(id,signature,question,spec,source,rationale,demand) VALUES(?,?,?,?,?,?,?) ON CONFLICT(signature) DO NOTHING`,
    crypto.randomUUID(),
    signature,
    question.trim(),
    JSON.stringify(spec),
    source,
    rationale,
    demand || null,
  );
}
export async function enqueueProposals() {
  const id = crypto.randomUUID();
  await run(
    "INSERT INTO jobs(id,kind,label) VALUES(?,'propose','Suggest research ideas (no crash queries)') ON CONFLICT DO NOTHING",
    id,
  );
  return { queued: true };
}
export async function proposeIdeas(progress: (s: string) => Promise<void>, jobId?: string) {
  const s = await summary(undefined, { cachedOnly: true });
  if (!s.crashes) throw new Error("Load data and prepare the summary first.");
  const cp = await discoveryCheckpoints(jobId);
  const years = [...new Set(s.completeMonths.map((m: string) => m.slice(0, 4)))].filter((y) =>
    Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, "0")}`).every((m) =>
      s.completeMonths.includes(m),
    ),
  );
  const year = years.at(-1);
  const start = year ? `${year}-01-01` : s.start!,
    end = year ? `${year}-12-31` : s.end!;
  const targets = ["Dallas", "Houston", "Austin", "San Antonio", "Fort Worth", "El Paso"]
    .map((c) => s.cities.find((x: string) => x.toLowerCase() === c.toLowerCase()))
    .filter(Boolean) as string[];
  const cities = targets.length ? targets : s.cities.filter(usableLocation).slice(0, 6);
  await progress("Preparing local and seasonal research ideas from cached coverage");
  for (const k of keywordSeeds)
    await saveIdea(
      `${k.question} (${start} to ${end})`,
      {
        cohort: k.cohort,
        group: k.group,
        metric: k.group === "road" ? "severe" : "crashes",
        start,
        end,
        min: 10,
        limit: 24,
      },
      "Keyword Planner research",
      k.note,
      `Topic: "${k.keyword}" · ${k.volume} average monthly searches. ${keywordSnapshot.geography}; ${keywordSnapshot.language}; ${keywordSnapshot.network}; ${keywordSnapshot.period}. Observed ${keywordSnapshot.observed}. Topic estimate, not volume for this proposed question; close variants may overlap. Not LLM prompt volume.`,
    );
  for (const city of cities)
    for (const [cohort, group, metric, question] of [
      [
        "all",
        "intersection",
        "severe",
        `Which reported intersections in ${city} had the most serious crashes?`,
      ],
      ["truck", "road", "crashes", `Where were truck-involved crashes concentrated in ${city}?`],
      [
        "pedestrian",
        "hour",
        "severe",
        `At what hours did serious pedestrian crashes occur in ${city}?`,
      ],
      ["all", "weekday", "crashes", `How did reported crashes vary by weekday in ${city}?`],
      [
        "truck",
        "light",
        "crashes",
        `What lighting conditions were recorded in ${city} truck crashes?`,
      ],
    ] as const) {
      await saveIdea(
        `${question} (${start} to ${end})`,
        { cohort, group, metric, city, start, end, min: 10, limit: 15 },
        "Editorial template",
        "A local research candidate, not a measured popular search or a verified finding.",
      );
    }
  if (year && years.includes(String(Number(year) - 1)))
    for (const city of cities)
      await saveIdea(
        `How did pedestrian crashes in ${city} change in ${year} versus ${Number(year) - 1}?`,
        {
          cohort: "pedestrian",
          group: "month",
          metric: "crashes",
          city,
          start,
          end,
          min: 1,
          limit: 24,
          compare: "year_over_year",
        },
        "Editorial template",
        "Matched full-year comparison; check reporting amendments and small samples.",
      );
  let aiError: string | undefined;
  if (runtime().OPENAI_API_KEY && runtime().OPENAI_MODEL) {
    await progress("AI: proposing additional questions for your approval");
    const existing = await all<any>(
      "SELECT question FROM research_ideas ORDER BY updated DESC LIMIT 80",
    );
    // Cache successful provider output so a later database failure does not buy it again.
    const plan = await cp.query(
      "proposal-list",
      { start, end },
      "AI proposals",
      progress,
      async () => {
        try {
          return {
            ideas: await aiPropose({
              start: s.start,
              end: s.end,
              cities: s.cities,
              existingQuestions: existing.map((x) => x.question),
            }),
            error: undefined as string | undefined,
          };
        } catch (error) {
          return {
            ideas: [] as Awaited<ReturnType<typeof aiPropose>>,
            error: requestFailure(error).error,
          };
        }
      },
    );
    const ideas = plan.ideas;
    aiError = plan.error;
    for (const idea of ideas)
      await saveIdea(
        idea.question,
        idea.spec,
        "AI hypothesis",
        "Proposed from available fields and coverage. Search popularity is not measured.",
      );
  }
  const count = await first<any>("SELECT COUNT(*) n FROM research_ideas WHERE status='suggested'");
  return {
    ideas: count?.n,
    aiError,
    note: "Ideas await approval; no crash-ranking queries were run.",
  };
}
export async function approveIdea(id: string, input?: { question?: string; spec?: unknown }) {
  return transaction(async () => {
    const idea = await first<any>("SELECT * FROM research_ideas WHERE id=? FOR UPDATE", id);
    if (!idea) throw new Error("Research idea not found.");
    if (idea.status === "queued" || idea.status === "complete")
      return { jobId: idea.job_id, status: idea.status };
    if (idea.status !== "suggested") throw new Error("Restore the dismissed idea before approval.");
    const spec = validateSpec(input?.spec ?? JSON.parse(idea.spec));
    const question = input?.question?.trim() || idea.question;
    if (question.length > 500) throw new Error("Question is too long.");
    const jobId = crypto.randomUUID();
    await run(
      "INSERT INTO jobs(id,kind,label,payload) VALUES(?,'research',?,?)",
      jobId,
      question,
      JSON.stringify({ ideaId: id, spec, question }),
    );
    await run(
      "UPDATE research_ideas SET status='queued',spec=?,question=?,job_id=?,updated=now() WHERE id=?",
      JSON.stringify(spec),
      question,
      jobId,
      id,
    );
    return { jobId, status: "queued" };
  });
}
export async function researchIdea(job: any, progress: (s: string) => Promise<void>) {
  const { ideaId, spec, question } = JSON.parse(job.payload);
  const cp = await discoveryCheckpoints(job.id);
  const evidence = await cp.query("approved-research", spec, "Approved research", progress, () =>
    research(spec, progress, (stage, task) =>
      cp.query("research-stage-v1", { spec, stage }, stage, progress, task),
    ),
  );
  return cp.commit("approved-finding", ideaId, async () => {
    const id = `idea-${ideaId}`;
    const qualified = evidence.rows.some(
      (r) => r[spec.metric as "crashes"] > 0 && usableLocation(r.label),
    );
    await run(
      `INSERT INTO findings(id,signature,title,category,summary,score,status,evidence,created,updated) VALUES(?,?,?,'Approved research',?,70,'new',?,?,?) ON CONFLICT(id) DO NOTHING`,
      id,
      id,
      question,
      qualified
        ? "Research completed. Review the exact period, filters, and evidence before publication."
        : "Research completed with no qualifying named groups. This is not evidence of zero crashes.",
      JSON.stringify(evidence),
      new Date().toISOString(),
      new Date().toISOString(),
    );
    await run(
      "UPDATE research_ideas SET status='complete',finding_id=?,updated=now() WHERE id=?",
      id,
      ideaId,
    );
    return {
      findingId: id,
      note: qualified
        ? "Verified evidence ready for review."
        : "No qualifying result; do not turn this into a ranking headline.",
    };
  });
}
