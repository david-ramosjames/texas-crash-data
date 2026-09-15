import { all, run } from "./db";
import { enqueueProposals } from "./ideas";
import { usableLocation } from "./research-quality";
import { research, summary, type QueryProgress } from "./research";
import { Evidence, Spec, COHORTS, number, titleCase } from "./contracts";
import { discoveryCheckpoints } from "./discovery-checkpoints";
import { starterArticle } from './editorial';
type FindingOutcome = { created: number; refreshed: number };
export async function discover(progress: QueryProgress = async () => {}, jobId?: string) {
  const s = await summary(progress);
  if (!s.crashes) throw new Error("Import a complete TxDOT batch before scanning.");
  const checkpoints = await discoveryCheckpoints(jobId);
  const scanResearch = (spec: Spec, label: string) =>
    checkpoints.query("research", spec, label, progress, () =>
      research(
        spec,
        (stage) => progress(`${label} · ${stage}`),
        (stage, task) =>
          checkpoints.query(
            "research-stage-v1",
            { spec, stage },
            `${label} · ${stage}`,
            progress,
            task,
          ),
      ),
    );
  const probes: {
    cohort: Spec["cohort"];
    group: Spec["group"];
    metric: Spec["metric"];
    category: string;
    city?: string;
  }[] = [];
  for (const cohort of ["all", "truck", "cmv", "pedestrian", "cyclist", "motorcycle"] as const) {
    for (const group of ["city", "intersection", "hour"] as const)
      probes.push({
        cohort,
        group,
        metric: cohort === "all" ? "severe" : "crashes",
        category: COHORTS[cohort],
      });
  }
  for (const group of ["county", "weather", "light", "weekday", "make", "body"] as const)
    probes.push({
      cohort: "all",
      group,
      metric: "crashes",
      category: "Conditions & patterns",
    });
  if (s.completeMonths.length >= 2)
    probes.push({
      cohort: "all",
      group: "month",
      metric: "crashes",
      category: "Historical coverage",
    });
  // A statewide volume ranking can bury useful local stories. Probe the six
  // largest loaded city cohorts as well; only save results that qualify.
  const cityEvidence = await scanResearch(
    {
      cohort: "all",
      group: "city",
      metric: "crashes",
      start: s.start,
      end: s.end,
      min: 30,
      limit: 8,
    },
    "Selecting city cohorts",
  );
  for (const city of cityEvidence.rows
    .filter((r) => usableLocation(r.label))
    .slice(0, 6)
    .map((r) => r.label)) {
    probes.push({
      cohort: "all",
      group: "intersection",
      metric: "crashes",
      category: titleCase(city) + " · Intersections",
      city,
    });
    probes.push({
      cohort: "truck",
      group: "road",
      metric: "crashes",
      category: titleCase(city) + " · Trucks",
      city,
    });
    probes.push({
      cohort: "pedestrian",
      group: "hour",
      metric: "crashes",
      category: titleCase(city) + " · Pedestrians",
      city,
    });
  }
  let created = 0,
    refreshed = 0,
    resumed = 0;
  const now = new Date().toISOString();
  for (const [index, p] of probes.entries()) {
    const phase = `Question ${index + 1}/${probes.length}: ${p.cohort} by ${p.group}`;
    const spec: Spec = {
      ...p,
      start: s.start,
      end: s.end,
      min: p.group === "intersection" ? 3 : 10,
      limit: 10,
    };
    const completed = await checkpoints.read<FindingOutcome>("probe", spec);
    if (completed) {
      created += completed.created;
      refreshed += completed.refreshed;
      resumed++;
      await progress(`${phase} · Already complete; resuming next question`);
      continue;
    }
    const e = await scanResearch(spec, phase);
    const r = e.rows.find(
      (x) =>
        usableLocation(x.label) &&
        (p.metric === "severe" ? x.severe >= 3 : x.crashes >= 10),
    );
    if (!r) {
      await checkpoints.commit("probe", spec, async () => ({ created: 0, refreshed: 0 }));
      continue;
    }
    const value = r[p.metric];
    if (!value) {
      await checkpoints.commit("probe", spec, async () => ({ created: 0, refreshed: 0 }));
      continue;
    }
    const metric =
      p.metric === "severe"
        ? "fatal or serious-injury crashes"
        : p.metric === "fatal"
          ? "fatal crashes"
          : "crashes";
    const context =
      p.cohort === "all"
        ? ""
        : ` involving ${p.cohort === "cmv" ? "commercial motor vehicles" : p.cohort === "truck" ? "trucks / truck tractors" : p.cohort === "pedestrian" ? "pedestrians" : p.cohort === "cyclist" ? "cyclists" : "motorcycles"}`;
    const label = p.group === "hour" ? `${r.label} hour` : titleCase(r.label);
    const title = `${p.city && p.group !== "intersection" && p.group !== "road" ? titleCase(p.city) + " · " : ""}${label}: ${number(value)} ${metric}${context}`;
    const summary = `${label} is the highest-ranked named group in this ${p.group} analysis. ${number(r.severe)} of its ${number(r.crashes)} matching crashes were classified as fatal or suspected serious injury. Explore the complete ranking and its limits before choosing a headline.`;
    const signature = `${p.cohort}:${p.group}:${p.metric}${p.city ? ":" + p.city.toLowerCase().replace(/[^a-z0-9]/g, "-") : ""}`;
    const id = `finding-${signature.replace(/:/g, "-")}`;
    const score = Math.min(
      98,
      Math.round(
        30 +
          Math.log10(r.crashes + 1) * 7 +
          Math.min(r.severe, 15) +
          (p.city ? 12 : 0) +
          (p.cohort !== "all" ? 12 : 0) +
          (p.metric === "severe" ? 10 : 0) +
          (["intersection", "road"].includes(p.group) ? 12 : 0) -
          (["weather", "light", "make", "body"].includes(p.group) ? 20 : 0),
      ),
    );
    await progress(`${phase} · Saving finding`);
    const outcome = await checkpoints.commit("probe", spec, async () => {
      const old = await all<any>("SELECT evidence,status FROM findings WHERE id=?", id);
      const changed =
        old.length &&
        JSON.stringify({
          rows: JSON.parse(old[0].evidence).rows,
          total: JSON.parse(old[0].evidence).total,
          spec: JSON.parse(old[0].evidence).spec,
        }) !== JSON.stringify({ rows: e.rows, total: e.total, spec: e.spec });
      await run(
        "INSERT INTO findings(id,signature,title,category,summary,score,status,evidence,created,updated) VALUES(?,?,?,?,?,?,'new',?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,summary=excluded.summary,score=excluded.score,evidence=excluded.evidence,updated=excluded.updated,status=CASE WHEN ?=1 AND findings.status='approved' THEN 'review' ELSE findings.status END",
        id,
        signature,
        title,
        p.category,
        summary,
        score,
        JSON.stringify(e),
        now,
        now,
        changed ? 1 : 0,
      );
      return { created: old.length ? 0 : 1, refreshed: old.length ? 1 : 0 };
    });
    created += outcome.created;
    refreshed += outcome.refreshed;
  }
  let comparisons = 0;
  const months: string[] = s.completeMonths;
  if (months.length >= 2) {
    const latest = months.at(-1)!;
    const priorYear = String(Number(latest.slice(0, 4)) - 1) + latest.slice(4);
    const before = months.includes(priorYear) ? priorYear : months.at(-2)!;
    const endOf = (m: string) => {
      const [y, n] = m.split("-").map(Number);
      return new Date(Date.UTC(y, n, 0)).toISOString().slice(0, 10);
    };
    for (const cohort of ["all", "truck", "pedestrian"] as const) {
      const spec: Spec = {
        cohort,
        group: "city",
        metric: "crashes",
        start: latest + "-01",
        end: endOf(latest),
        min: 20,
        limit: 100,
      };
      const current = await scanResearch(spec, `Comparison: ${cohort}, current month`),
        previous = await scanResearch(
          {
            ...spec,
            start: before + "-01",
            end: endOf(before),
          },
          `Comparison: ${cohort}, previous period`,
        );
      const candidates = current.rows
        .map((r) => ({
          r,
          old: previous.rows.find((p) => p.label === r.label),
        }))
        .filter(
          (x) =>
            x.old &&
            x.old.crashes >= 20 &&
            Math.abs(x.r.crashes - x.old.crashes) >= 10 &&
            Math.abs(x.r.crashes / x.old.crashes - 1) >= 0.25 &&
            usableLocation(x.r.label),
        )
        .sort(
          (a, b) => Math.abs(b.r.crashes - b.old!.crashes) - Math.abs(a.r.crashes - a.old!.crashes),
        )
        .slice(0, 3);
      for (const { r, old } of candidates) {
        const delta = r.crashes - old!.crashes,
          pc = Math.round((Math.abs(delta) / old!.crashes) * 100),
          id = `change-${cohort}-${r.label.toLowerCase().replace(/[^a-z0-9]/g, "-")}`;
        const e: Evidence = {
          ...current,
          comparison: {
            focusLabel: r.label,
            kind: before === priorYear ? 'Year over year' : 'Month over month',
            start: previous.spec.start,
            end: previous.spec.end,
            rows: previous.rows,
            total: previous.total,
            caveat:
              before === priorYear
                ? "Year-over-year counts do not control for exposure, reporting differences, or road changes."
                : "These calendar months may differ in season and number of days. Raw counts are not exposure-adjusted rates.",
          },
          sources: [
            ...current.sources,
            ...previous.sources.filter((p) => !current.sources.some((c) => c.id === p.id)),
          ],
          warnings: [
            "Exploratory change selected from many comparisons; no statistical significance is asserted.",
            ...current.warnings,
          ],
        };
        const title = `${titleCase(r.label)}: ${cohort === "all" ? "crashes" : cohort + "-involved crashes"} ${delta > 0 ? "up" : "down"} ${pc}% between ${before} and ${latest}`;
        const description = `${number(old!.crashes)} matching crashes in ${before}; ${number(r.crashes)} in ${latest} (${delta > 0 ? "+" : ""}${number(delta)}). Both calendar intervals are covered by supplied extracts. ${e.comparison!.caveat}`;
        await progress(`Comparison: ${cohort} · Saving finding`);
        const outcome = await checkpoints.commit(
          "comparison-finding",
          { spec, before, id },
          async () => {
            const prior = await all<any>("SELECT evidence,status FROM findings WHERE id=?", id);
            const changed =
              prior.length &&
              JSON.stringify(JSON.parse(prior[0].evidence).comparison) !==
                JSON.stringify(e.comparison);
            await run(
              "INSERT INTO findings(id,signature,title,category,summary,score,status,evidence,created,updated) VALUES(?,?,?,'Changes over time',?,85,'new',?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,summary=excluded.summary,evidence=excluded.evidence,updated=excluded.updated,status=CASE WHEN ?=1 AND findings.status='approved' THEN 'review' ELSE findings.status END",
              id,
              id,
              title,
              description,
              JSON.stringify(e),
              now,
              now,
              changed ? 1 : 0,
            );
            return { created: prior.length ? 0 : 1, refreshed: prior.length ? 1 : 0 };
          },
        );
        created += outcome.created;
        refreshed += outcome.refreshed;
        comparisons++;
      }
    }
  }
  const aiIdeas = 0, aiError = undefined;
  await enqueueProposals();
  await checkpoints.assertCurrent();
  await progress("Discovery questions finished; preparing results");
  return {
    created,
    refreshed,
    probes: probes.length,
    resumed,
    comparisons,
    aiIdeas,
    aiError,
    engine: "Automated evidence scan",
    note: "Editorial priority is a heuristic based on sample size, severe outcomes, and location specificity—not statistical significance.",
  };
}
export function draftBody(e: Evidence, title: string, channel: string) {
  return starterArticle(e, channel);
}
