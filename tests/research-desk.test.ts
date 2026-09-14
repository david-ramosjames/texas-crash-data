import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { parseCrashHour, CSVParser, readCSV } from "../lib/csv";
import { validateSpec, compile, research } from "../lib/research";
import {
  comparisonRow,
  needsTimeRefresh,
  periodLabel,
  usableLocation,
} from "../lib/research-quality";
import { plannerRows } from "../lib/keyword-planner";
import { all, first, run, withConnection } from "../lib/db";
import { saveIdea, approveIdea, proposeIdeas, researchIdea } from "../lib/ideas";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IdeasInbox } from "../components/ideas-inbox";
import { Bars, EvidencePanel } from "../components/evidence";
const spec = validateSpec({ start: "2024-01-01", end: "2024-12-31", group: "city", min: 1 });
test("AM/PM parsing distinguishes midnight, noon, evening and unknown time", () => {
  for (const [value, hour] of [
    ["12:00 AM", 0],
    ["12:00 PM", 12],
    ["06:15 PM", 18],
    ["6:15:59 am", 6],
    ["23:59", 23],
    ["0000", 0],
    ["1830", 18],
    ["", null],
    ["99:99", null],
  ] as const)
    assert.equal(parseCrashHour(value), hour, value);
  for (const value of ["25:00", "12:60 AM", "00:30 PM", "13:00 PM", "garbage"])
    assert.throws(() => parseCrashHour(value), /Crash_Time/);
});
test("every minute of the observed 12-hour TxDOT format maps to the correct hour", () => {
  for (let hour = 0; hour < 24; hour++) {
    for (let minute = 0; minute < 60; minute++) {
      const time = `${String(hour % 12 || 12).padStart(2, '0')}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
      assert.equal(parseCrashHour(time), hour, time);
    }
  }
});
test("aborting CSV validation cancels the archived source stream", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode('Crash_Time\ninvalid\n')); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(async () => {
    for await (const row of readCSV({ stream: () => stream })) parseCrashHour(row.Crash_Time);
  }, /Crash_Time/);
  assert.equal(cancelled, true);
});
test("new filters are validated and use one matching vehicle", () => {
  const s = validateSpec({
    ...spec,
    group: "body",
    make: "FORD",
    color: "WHITE",
    model: "F150",
    factor: "TEST",
    yearMin: 2020,
    yearMax: 2025,
    hourFrom: 0,
    hourThrough: 12,
    speedMin: 0,
    speedMax: 55,
    weather: "RAIN",
    rural: "N",
  });
  const q = compile(s);
  assert.match(q.sql, /u.year>=\?/);
  assert.match(q.sql, /c.hour>=\?/);
  assert.equal(q.args.filter((x) => x === "FORD").length, 2);
  assert.equal(q.args.filter((x) => x === "F150").length, 2);
  for (const changed of [
    { hourFrom: 24 },
    { hourFrom: 20, hourThrough: 2 },
    { yearMin: 1800 },
    { speedMax: 151 },
    { compare: "bad" },
  ])
    assert.throws(() => validateSpec({ ...spec, ...changed }));
});
test("quality gates, period labels and month-aligned comparisons are explicit", () => {
  for (const label of ["Not Reported", "Dallas · NOT REPORTED & MAIN", "UNKNOWN (9999)", ""])
    assert.equal(usableLocation(label), false);
  assert.equal(usableLocation("DALLAS · MAIN & OAK"), true);
  assert(needsTimeRefresh({ spec: { ...spec, group: "hour" } } as any));
  assert(!needsTimeRefresh({ spec: { ...spec, group: "hour" }, timeVersion: 2 } as any));
  const e: any = {
    spec: { ...spec, group: "month", compare: "year_over_year" },
    comparison: {
      start: "2023-01-01",
      end: "2023-12-31",
      rows: [{ label: "2023-02", crashes: 5 }],
    },
  };
  assert.equal(comparisonRow(e, "2024-02")?.crashes, 5);
  assert.equal(comparisonRow(e, "2024-03"), undefined);
  assert.match(periodLabel({ spec } as any), /Annual.*2024/);
});
test("Keyword Planner preserves ranges, quoted keywords and missing estimates", () => {
  const rows = plannerRows(
    'Keyword Stats\nSeptember 2025 - August 2026\nKeyword\tAvg. monthly searches\tCompetition\n"truck, accident statistics"\t10 – 100\tLow\nmissing\t\t\n',
  );
  assert.deepEqual(rows, [
    { question: "truck, accident statistics", estimate: "10 – 100" },
    { question: "missing", estimate: "Not available" },
  ]);
  assert.equal(
    plannerRows('Keyword,Avg. monthly searches\ncrashes,"1,000"\n')[0].estimate,
    "1,000",
  );
  assert.throws(() => plannerRows("Keyword,Volume\ncrash,100"), /Expected/);
  assert.throws(
    () => plannerRows("Keyword,Avg. monthly searches\ncrash,probably popular"),
    /Unrecognized/,
  );
  assert.deepEqual(new CSVParser().feed('a,"b,c"\n', true), [["a", "b,c"]]);
});
test("approval desk renders questions and demand separately from verified evidence", () => {
  const html = renderToStaticMarkup(
    createElement(IdeasInbox, {
      ideas: [
        {
          id: "i",
          source: "AI hypothesis",
          status: "suggested",
          question: "A possible question?",
          rationale: "Not researched",
          spec,
        },
      ],
      summary: { ...spec, crashes: 1 },
      api: async () => ({}),
      refresh: async () => {},
      selectFinding: () => {},
    }),
  );
  assert.match(html, /Review plan and approve/);
  assert.match(html, /not verified findings/);
  assert.match(html, /LLM question-volume/);
  const e: any = {
    spec: { ...spec, metric: "severe" },
    rows: [{ label: "Dallas", crashes: 10, severe: 3, fatal: 0 }],
    comparison: {
      focusLabel: "Dallas",
      rows: [{ label: "Dallas", crashes: 8, severe: 0, fatal: 0 }],
      start: "2023-01-01",
      end: "2023-12-31",
    },
    warnings: [],
    sources: [],
    total: 10,
    severe: 3,
    fatal: 0,
    generated: "2026-09-14",
  };
  const card = renderToStaticMarkup(createElement(Bars, { e, small: true }));
  assert.match(card, /Previous/);
  assert.match(card, /0.*3/);
  assert.doesNotMatch(card, /Infinity|NaN/);
  assert.match(renderToStaticMarkup(createElement(EvidencePanel, { e })), /No percentage baseline/);
});
test("ideas are cheap, deduplicated, approval-gated, and research completion is replay-safe", async () => {
  const pg = new PGlite();
  for (const name of ["001_core.sql", "004_discovery_checkpoints.sql", "007_research_desk.sql"])
    await pg.exec(await readFile(new URL("../migrations/" + name, import.meta.url), "utf8"));
  const queries: string[] = [];
  const connection = {
    query: async (sql: string, args?: any[]) => {
      queries.push(sql);
      const r = await pg.query(sql, args);
      return { ...r, rowCount: r.affectedRows };
    },
  };
  try {
    await withConnection(connection, async () => {
      await run(
        "INSERT INTO batches(id,extraction,start,\"end\",status,time_parser_version,created,manifest) VALUES('b','20260914000000','2023-01-01','2024-12-31','complete',2,'2026-09-14','[]')",
      );
      await run(
        "INSERT INTO crashes(batch_id,id,date,hour,city,county,road,intersection,severity,cmv,deaths,serious,injuries,weather,light,rural,speed,intersection_flag) VALUES('b','1','2024-02-01',18,'DALLAS','DALLAS','MAIN','',1,0,0,1,1,'CLEAR','DAYLIGHT','N',35,0)",
      );
      await run(
        "INSERT INTO crashes(batch_id,id,date,hour,city,county,road,intersection,severity,cmv,deaths,serious,injuries,weather,light,rural,speed,intersection_flag) VALUES('b','2','2023-02-01',18,'DALLAS','DALLAS','MAIN','',1,0,0,1,1,'CLEAR','DAYLIGHT','N',35,0)",
      );
      await run(
        "INSERT INTO current_crashes(id,batch_id,extraction) VALUES('1','b','20260914000000'),('2','b','20260914000000')",
      );
      await run(
        "INSERT INTO settings(key,value) VALUES('summary_cache',?)",
        JSON.stringify({
          generation: "0",
          value: {
            crashes: 2,
            start: "2023-02-01",
            end: "2024-02-01",
            severe: 2,
            fatal: 0,
            cmv: 0,
            located: 0,
            deaths: 0,
            cities: ["DALLAS"],
          },
        }),
      );
      const key = process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY;
      queries.length = 0;
      try {
        await proposeIdeas(async () => {});
      } finally {
        if (key) process.env.OPENAI_API_KEY = key;
      }
      assert(
        !queries.some((q) => /FROM (?:studio\.)?(?:crashes|current_crashes)\b/i.test(q)),
        "Proposals must not scan crash history",
      );
      assert((await all("SELECT * FROM research_ideas")).length >= 10);
      assert.equal((await first<any>("SELECT COUNT(*) n FROM jobs WHERE kind='research'")).n, 0);
      await saveIdea("Local question", spec, "Your question", "test");
      await saveIdea("Local question", spec, "Your question", "test");
      await saveIdea("Different question", spec, "Your question", "test");
      const idea = await first<any>("SELECT * FROM research_ideas WHERE question='Local question'");
      assert.equal(
        (await first<any>("SELECT COUNT(*) n FROM research_ideas WHERE question='Local question'"))
          .n,
        1,
      );
      const approved = await approveIdea(idea.id);
      assert.equal((await approveIdea(idea.id)).jobId, approved.jobId);
      const job = await first<any>("SELECT * FROM jobs WHERE id=?", approved.jobId);
      const result = await researchIdea(job, async () => {});
      assert(result.findingId);
      await researchIdea(job, async () => {});
      assert.equal(
        (await first<any>("SELECT COUNT(*) n FROM findings WHERE id=?", result.findingId)).n,
        1,
      );
      assert.equal(
        (await first<any>("SELECT status FROM research_ideas WHERE id=?", idea.id)).status,
        "complete",
      );
      const e = await research({ ...spec, group: "month", compare: "year_over_year" });
      assert.equal(e.rows[0].label, "2024-02");
      assert.equal(comparisonRow(e, "2024-02")?.crashes, 1);
      assert.equal(e.comparison?.start, "2023-01-01");
    });
  } finally {
    await pg.close();
  }
});
