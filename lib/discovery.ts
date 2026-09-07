import { all, run, runtime } from './db';
import { aiPropose } from './ai';
import { research, summary } from './research';
import { Evidence, Spec, COHORTS, number, titleCase } from './contracts';
export async function discover() {
  const s = await summary();
  if (!s.crashes)
    throw new Error('Import a complete TxDOT batch before scanning.');
  const probes: {
    cohort: Spec['cohort'];
    group: Spec['group'];
    metric: Spec['metric'];
    category: string;
    city?: string;
  }[] = [];
  for (const cohort of [
    'all',
    'truck',
    'cmv',
    'pedestrian',
    'cyclist',
    'motorcycle',
  ] as const) {
    for (const group of ['city', 'intersection', 'hour'] as const)
      probes.push({
        cohort,
        group,
        metric: cohort === 'all' ? 'severe' : 'crashes',
        category: COHORTS[cohort],
      });
  }
  for (const group of [
    'county',
    'weather',
    'light',
    'weekday',
    'make',
    'body',
  ] as const)
    probes.push({
      cohort: 'all',
      group,
      metric: 'crashes',
      category: 'Conditions & patterns',
    });
  if (s.completeMonths.length >= 2)
    probes.push({
      cohort: 'all',
      group: 'month',
      metric: 'crashes',
      category: 'Historical coverage',
    });
  // A statewide volume ranking can bury useful local stories. Probe the six
  // largest loaded city cohorts as well; only save results that qualify.
  const cityEvidence = await research({
    cohort: 'all',
    group: 'city',
    metric: 'crashes',
    start: s.start,
    end: s.end,
    min: 30,
    limit: 8,
  });
  for (const city of cityEvidence.rows
    .filter((r) => !/^Unknown|^Not recorded/i.test(r.label))
    .slice(0, 6)
    .map((r) => r.label)) {
    probes.push({
      cohort: 'all',
      group: 'intersection',
      metric: 'crashes',
      category: titleCase(city) + ' · Intersections',
      city,
    });
    probes.push({
      cohort: 'truck',
      group: 'road',
      metric: 'crashes',
      category: titleCase(city) + ' · Trucks',
      city,
    });
    probes.push({
      cohort: 'pedestrian',
      group: 'hour',
      metric: 'crashes',
      category: titleCase(city) + ' · Pedestrians',
      city,
    });
  }
  let created = 0,
    refreshed = 0;
  const now = new Date().toISOString();
  for (const p of probes) {
    const spec: Spec = {
      ...p,
      start: s.start,
      end: s.end,
      min: p.group === 'intersection' ? 3 : 10,
      limit: 10,
    };
    const e = await research(spec);
    const r = e.rows.find(
      (x) =>
        !/^Unknown|^Not recorded/i.test(x.label) &&
        (p.metric === 'severe' ? x.severe >= 3 : x.crashes >= 10),
    );
    if (!r) continue;
    const value = r[p.metric];
    if (!value) continue;
    const metric =
      p.metric === 'severe'
        ? 'fatal or serious-injury crashes'
        : p.metric === 'fatal'
          ? 'fatal crashes'
          : 'crashes';
    const context =
      p.cohort === 'all'
        ? ''
        : ` involving ${p.cohort === 'cmv' ? 'commercial motor vehicles' : p.cohort === 'truck' ? 'trucks / truck tractors' : p.cohort === 'pedestrian' ? 'pedestrians' : p.cohort === 'cyclist' ? 'cyclists' : 'motorcycles'}`;
    const label = p.group === 'hour' ? `${r.label} hour` : titleCase(r.label);
    const title = `${p.city && p.group !== 'intersection' && p.group !== 'road' ? titleCase(p.city) + ' · ' : ''}${label}: ${number(value)} ${metric}${context}`;
    const summary = `${label} is the highest-ranked named group in this ${p.group} analysis. ${number(r.severe)} of its ${number(r.crashes)} matching crashes were classified as fatal or suspected serious injury. Explore the complete ranking and its limits before choosing a headline.`;
    const signature = `${p.cohort}:${p.group}:${p.metric}${p.city ? ':' + p.city.toLowerCase().replace(/[^a-z0-9]/g, '-') : ''}`;
    const id = `finding-${signature.replace(/:/g, '-')}`;
    const score = Math.min(
      98,
      Math.round(
        30 +
          Math.log10(r.crashes + 1) * 7 +
          Math.min(r.severe, 15) +
          (p.city ? 12 : 0) +
          (p.cohort !== 'all' ? 12 : 0) +
          (p.metric === 'severe' ? 10 : 0) +
          (['intersection','road'].includes(p.group) ? 12 : 0) -
          (['weather','light','make','body'].includes(p.group) ? 20 : 0),
      ),
    );
    const old = await all<any>(
      'SELECT evidence,status FROM findings WHERE id=?',
      id,
    );
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
    old.length ? refreshed++ : created++;
  }
  let comparisons = 0;
  const months: string[] = s.completeMonths;
  if (months.length >= 2) {
    const latest = months.at(-1)!;
    const priorYear = String(Number(latest.slice(0, 4)) - 1) + latest.slice(4);
    const before = months.includes(priorYear) ? priorYear : months.at(-2)!;
    const endOf = (m: string) => {
      const [y, n] = m.split('-').map(Number);
      return new Date(Date.UTC(y, n, 0)).toISOString().slice(0, 10);
    };
    for (const cohort of ['all', 'truck', 'pedestrian'] as const) {
      const spec: Spec = {
        cohort,
        group: 'city',
        metric: 'crashes',
        start: latest + '-01',
        end: endOf(latest),
        min: 20,
        limit: 100,
      };
      const current = await research(spec),
        previous = await research({
          ...spec,
          start: before + '-01',
          end: endOf(before),
        });
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
            !/^Unknown|^Not recorded/i.test(x.r.label),
        )
        .sort(
          (a, b) =>
            Math.abs(b.r.crashes - b.old!.crashes) -
            Math.abs(a.r.crashes - a.old!.crashes),
        )
        .slice(0, 3);
      for (const { r, old } of candidates) {
        const delta = r.crashes - old!.crashes,
          pc = Math.round((Math.abs(delta) / old!.crashes) * 100),
          id = `change-${cohort}-${r.label.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
        const e: Evidence = {
          ...current,
          comparison: {
            start: previous.spec.start,
            end: previous.spec.end,
            rows: previous.rows,
            total: previous.total,
            caveat:
              before === priorYear
                ? 'Year-over-year counts do not control for exposure, reporting differences, or road changes.'
                : 'These calendar months may differ in season and number of days. Raw counts are not exposure-adjusted rates.',
          },
          sources: [
            ...current.sources,
            ...previous.sources.filter(
              (p) => !current.sources.some((c) => c.id === p.id),
            ),
          ],
          warnings: [
            'Exploratory change selected from many comparisons; no statistical significance is asserted.',
            ...current.warnings,
          ],
        };
        const title = `${titleCase(r.label)}: ${cohort === 'all' ? 'crashes' : cohort + '-involved crashes'} ${delta > 0 ? 'up' : 'down'} ${pc}% between ${before} and ${latest}`;
        const description = `${number(old!.crashes)} matching crashes in ${before}; ${number(r.crashes)} in ${latest} (${delta > 0 ? '+' : ''}${number(delta)}). Both calendar intervals are covered by supplied extracts. ${e.comparison!.caveat}`;
        const prior = await all<any>(
          'SELECT evidence,status FROM findings WHERE id=?',
          id,
        );
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
        prior.length ? refreshed++ : created++;
        comparisons++;
      }
    }
  }
  let aiIdeas = 0,
    aiError: string | undefined;
  if (runtime().OPENAI_API_KEY && runtime().OPENAI_MODEL) {
    try {
      const ideas = await aiPropose({
        start: s.start,
        end: s.end,
        cities: s.cities,
        existingQuestions: (
          await all<any>(
            'SELECT title FROM findings ORDER BY score DESC LIMIT 35',
          )
        ).map((x) => x.title),
      });
      for (const idea of ideas) {
        const e = await research(idea.spec);
        if (e.total < 20 || !e.rows.length) continue;
        const key = Array.from(
          new Uint8Array(
            await crypto.subtle.digest(
              'SHA-256',
              new TextEncoder().encode(JSON.stringify(e.spec)),
            ),
          ),
        )
          .slice(0, 12)
          .map((x) => x.toString(16).padStart(2, '0'))
          .join('');
        const id = 'ai-' + key;
        const prior = await all<any>(
          'SELECT evidence FROM findings WHERE id=?',
          id,
        );
        const lead = e.rows[0];
        await run(
          "INSERT INTO findings(id,signature,title,category,summary,score,status,evidence,created,updated) VALUES(?,?,?,'AI research angle',?,75,'new',?,?,?) ON CONFLICT(id) DO UPDATE SET evidence=excluded.evidence,updated=excluded.updated",
          id,
          id,
          idea.question,
          `Verified result: ${number(e.total)} matching crashes. ${titleCase(lead.label)} ranks first with ${number(lead[e.spec.metric])} ${e.spec.metric === 'severe' ? 'fatal or serious-injury crashes' : e.spec.metric === 'fatal' ? 'fatal crashes' : 'crashes'}. Review this AI-proposed question against the exact filters and evidence.`,
          JSON.stringify(e),
          now,
          now,
        );
        prior.length ? refreshed++ : created++;
        aiIdeas++;
      }
    } catch (error) {
      aiError =
        error instanceof Error
          ? error.message
          : 'AI proposals unavailable. The automated evidence scan completed.';
    }
  }
  return {
    created,
    refreshed,
    probes: probes.length,
    comparisons,
    aiIdeas,
    aiError,
    engine: 'Automated evidence scan',
    note: 'Editorial priority is a heuristic based on sample size, severe outcomes, and location specificity—not statistical significance.',
  };
}
export function draftBody(e: Evidence, title: string, channel: string) {
  const lead = e.rows[0];
  const metrics =
    e.spec.metric === 'severe'
      ? 'fatal or serious-injury crashes'
      : e.spec.metric === 'fatal'
        ? 'fatal crashes'
        : 'reported crashes';
  const where = e.spec.city ? ` in ${titleCase(e.spec.city)}` : ' in Texas';
  const intro = `The supplied Texas Department of Transportation public crash extract records ${number(e.total)} matching crashes${where} from ${e.spec.start} through ${e.spec.end}. This analysis groups ${COHORTS[e.spec.cohort].toLowerCase()} by ${e.spec.group} and ranks them by ${metrics}.`;
  let findings = e.rows
    .slice(0, channel === 'social' ? 3 : 10)
    .map(
      (r, i) =>
        `${i + 1}. ${titleCase(r.label)}: ${number(r.crashes)} crashes; ${number(r.severe)} fatal or serious-injury crashes; ${number(r.fatal)} fatal crashes.`,
    )
    .join('\n');
  if (e.comparison)
    findings +=
      `\n\nCOMPARISON: ${e.comparison.start} through ${e.comparison.end}\n${e.comparison.caveat}\n` +
      e.rows
        .slice(0, 10)
        .map((r) => {
          const old = e.comparison!.rows.find((p) => p.label === r.label);
          return old
            ? `${titleCase(r.label)}: ${old.crashes} previously; ${r.crashes} currently.`
            : '';
        })
        .filter(Boolean)
        .join('\n');
  if (channel === 'social')
    return `${title}\n\n${lead ? `${titleCase(lead.label)} recorded ${number(lead[e.spec.metric])} ${metrics} in this extract. ` : ''}Period: ${e.spec.start} to ${e.spec.end}.\n\n${findings}\n\nThese are reported crash counts, not risk per trip. ${e.warnings[0]}\n\nSource: TxDOT public crash extract. See the full methodology before drawing conclusions.`;
  return `${intro}\n\nWHAT THE DATA SHOWS\n\n${findings}\n\nHOW TO READ THIS\n\nThis is an aggregate description of the supplied records. It does not establish why a crash occurred, identify fault, or measure the safety of a road or vehicle per trip.\n\nMETHODOLOGY & LIMITS\n\n${e.warnings.map((x) => '- ' + x).join('\n')}\n\nMinimum group size: ${e.spec.min}. ${number(e.excluded)} matching crashes excluded from this grouping because no usable reported intersection pair was recorded. ${number(e.unlocated)} matching crashes have no usable mapped coordinates.\n\nSOURCE\n\nTexas Department of Transportation public crash extract. ${e.sources.length} source batch(es). Data and query snapshot captured ${e.generated.slice(0, 10)}. Source batch IDs and reproducible query accompany this draft.`;
}
