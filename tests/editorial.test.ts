import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { all, first, run, withConnection } from "../lib/db";
import type { Draft, Evidence } from "../lib/contracts";
import {
  assertEditorialReady,
  BUILTIN_COVER,
  composeEditorial,
  editorialFacts,
  editorialMethods,
  expandEditorial,
  roadNameWarnings,
  starterArticle,
} from "../lib/editorial";
import { renderPage, renderChart } from "../lib/export";
import { articleEntries, standaloneArticle } from "../lib/editorial-package";
import { coverBytes, coverPrompt, generateCover, queueCover, validateCover } from "../lib/covers";
import { reportJobFailure } from "../lib/worker-diagnostics";
import { zip } from "../lib/zip";
import { aiWrite } from "../lib/ai";

// Synthetic fixture, not a verified live query.
export const evidence: Evidence = {
  spec: {
    cohort: "truck",
    group: "road",
    metric: "crashes",
    start: "2022-01-01",
    end: "2026-08-31",
    city: "EXAMPLE CITY",
    min: 10,
    limit: 10,
  },
  rows: [
    {
      label: "EXAMPLE CITY · E RL THORNTON FWY",
      crashes: 100,
      severe: 12,
      fatal: 4,
      deaths: 5,
      serious: 9,
    },
    {
      label: "EXAMPLE CITY · E R L THORNTON FWY",
      crashes: 60,
      severe: 8,
      fatal: 3,
      deaths: 4,
      serious: 7,
    },
    {
      label: "EXAMPLE CITY · S RL THORNTON FWY",
      crashes: 40,
      severe: 3,
      fatal: 1,
      deaths: 1,
      serious: 3,
    },
  ],
  total: 250,
  severe: 25,
  fatal: 9,
  unlocated: 11,
  excluded: 200,
  warnings: ["Supplied interval coverage is not a guarantee of complete reporting."],
  sources: [],
  generated: "2026-09-15T12:00:00Z",
  engine: "Synthetic test fixture",
  sql: "SELECT 1",
  parameters: [],
};
const draft: Draft = {
  id: "draft-test",
  title: "Where reported truck crashes concentrate",
  slug: "test-article",
  channel: "page",
  body: starterArticle(evidence, "page"),
  status: "approved",
  evidence,
  created: "2026-09-15",
  updated: "2026-09-15",
};
test("editorial facts distinguish people, crashes, denominator and possible aliases", () => {
  const facts = editorialFacts(evidence);
  assert.match(facts.row1_people, /5 deaths and 9 people with suspected serious injuries/);
  assert.match(facts.row1_share, /40.0%/);
  assert.equal(roadNameWarnings(evidence).length, 1);
  assert(!roadNameWarnings(evidence)[0].includes("S Rl"));
  assert(!editorialMethods(evidence).join(" ").includes("200 matching crashes were excluded"));
  assert(
    editorialMethods({ ...evidence, spec: { ...evidence.spec, group: "intersection" } })
      .join(" ")
      .includes("200 matching crashes were excluded"),
  );
  assert.equal(evidence.rows.length, 3, "Do not merge original road groups");
  assert.throws(
    () => assertEditorialReady("There were 39 serious-injury crashes."),
    /people, not crashes/,
  );
  assert.doesNotThrow(() =>
    assertEditorialReady(
      "There were 47 fatal or suspected serious-injury crashes and 39 people with suspected serious injuries.",
    ),
  );
  assert(!editorialFacts(evidence).row1_comparison);
  const compared = {
    ...evidence,
    comparison: {
      start: "2021-01-01",
      end: "2021-08-31",
      rows: [{ ...evidence.rows[0], crashes: 0 }],
      total: 0,
      caveat: "Periods differ; interpret cautiously.",
    },
  };
  assert.match(editorialFacts(compared).row1_comparison, /undefined from a zero baseline/);
  assert(!editorialFacts(compared).row2_comparison, "Missing prior result is not zero");
});
test("AI numerical facts must use validated complete-sentence tokens", () => {
  const text = expandEditorial(
    "[[fact:scope]]\n\n## The reported pattern\n\n[[fact:row1]]\n\n[[fact:row1_people]]",
    evidence,
  );
  assert.match(text, /9 people with suspected serious injuries/);
  assert(!text.includes("[[fact:"));
  assert.match(text, /## Verified statistics/);
  for (const invalid of [
    "[[fact:scope]] [[fact:row1]] 999 crashes",
    "[[fact:scope]] [[fact:row99]]",
    "[[fact:scope]] <script>alert()</script>",
    "[[fact:row1]]",
  ])
    assert.throws(() => expandEditorial(invalid, evidence));
  assert.equal(
    composeEditorial(text, evidence),
    text,
    "Repeated saves must not duplicate the appendix",
  );
  assert.match(
    composeEditorial(text.replace("100 reported crashes", "999 reported crashes"), evidence),
    /100 reported crashes/,
  );
});
test("full article AI call uses verified facts and does not send SQL or raw fields", async () => {
  const oldFetch = globalThis.fetch,
    oldKey = process.env.OPENAI_API_KEY,
    oldModel = process.env.OPENAI_MODEL;
  process.env.OPENAI_API_KEY = "test-only";
  process.env.OPENAI_MODEL = "test-model";
  globalThis.fetch = async (_url, init) => {
    const input = JSON.parse(String(init?.body));
    assert.match(input.instructions, /450–700/);
    const payload = JSON.parse(input.input);
    assert(payload.verifiedFacts);
    assert(!payload.evidence);
    assert(!payload.sql);
    return Response.json({
      output: [
        {
          type: "message",
          content: [
            { type: "output_text", text: "[[fact:scope]]\n\n## A closer look\n\n[[fact:row1]]" },
          ],
        },
      ],
    });
  };
  try {
    assert.match(await aiWrite(evidence, "page", "Test title"), /Verified statistics/);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldKey;
    if (oldModel === undefined) delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = oldModel;
  }
});
test("publication escapes text, keeps methods and stats, and renders deterministic chart", () => {
  const html = renderPage({
    ...draft,
    title: "<script>bad</script>",
    body: "## A heading\n\n<img src=x onerror=alert(1)>",
  });
  assert(html.includes("&lt;script&gt;bad"));
  assert(!html.includes("<script>bad"));
  assert(html.includes("&lt;img src=x"));
  assert(html.includes("Methods, definitions"));
  assert(html.includes("Suspected serious injuries (people)"));
  assert(html.includes("Possible road-name variants"));
  const svg = renderChart(draft);
  assert(svg.includes('width="1000"'));
  assert(svg.includes("100</text>"));
  assert(
    !renderPage({
      ...draft,
      cover: { id: "evil", url: "javascript:alert(1)", alt: "x", caption: "x" },
    }).includes('src="javascript:'),
  );
});
test("cover migration, queue deduplication, ownership, recovery, and export packaging", async () => {
  const pg = new PGlite();
  for (const file of ["001_core.sql", "007_research_desk.sql", "008_editorial_covers.sql"])
    await pg.exec(await readFile(new URL("../migrations/" + file, import.meta.url), "utf8"));
  const connection = {
    query: async (sql: string, args?: any[]) => {
      const r = await pg.query(sql, args);
      return { ...r, rowCount: r.affectedRows };
    },
  };
  const key = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-only";
  try {
    await withConnection(connection, async () => {
      await run(
        "INSERT INTO drafts(id,title,slug,channel,body,evidence,created,updated) VALUES(?,'Test','test','page',?,?,?,?)",
        draft.id,
        draft.body,
        JSON.stringify(evidence),
        draft.created,
        draft.updated,
      );
      const one = await queueCover(draft.id),
        two = await queueCover(draft.id);
      assert.equal(one.id, two.id);
      assert.equal((await all("SELECT id FROM jobs WHERE kind='cover'")).length, 1);
      assert.equal(await validateCover(BUILTIN_COVER, draft.id), BUILTIN_COVER);
      assert.equal(await validateCover(null, draft.id), null);
      await assert.rejects(() => validateCover("unknown", draft.id));
      await run(
        "INSERT INTO editorial_covers(id,draft_id,job_id,storage_key,mime,bytes,alt,prompt,model) VALUES('saved',?,?,?,'image/jpeg',4,'Test','Test','Test')",
        draft.id,
        one.id,
        "editorial-covers/test.jpg",
      );
      const recovered = await generateCover(
        { id: one.id, payload: "{}" },
        async () => {},
        async () => {
          throw new Error("Must not repeat generation");
        },
      );
      assert.equal(recovered.coverId, "saved");
      await assert.rejects(() => validateCover("saved", "another-draft"));
      await run("UPDATE jobs SET status='complete' WHERE id=?", one.id);
      const fresh = await queueCover(draft.id);
      let calls = 0,
        storedBytes: ArrayBuffer | undefined;
      const fakeStorage = {
        head: async () => null,
        put: async (_key: string, bytes: ArrayBuffer) => {
          storedBytes = bytes;
        },
        get: async () => {
          throw new Error("Unexpected read");
        },
      };
      const payload = JSON.stringify({ draftId: draft.id, cohort: "truck" });
      const generated = await generateCover(
        { id: fresh.id, payload },
        async () => {},
        async (url, init) => {
          calls++;
          assert.equal(url, "https://api.openai.com/v1/images/generations");
          const body = JSON.parse(String(init?.body));
          assert.equal(body.n, 1);
          assert.equal(body.output_format, "jpeg");
          assert(!body.prompt.includes("EXAMPLE CITY"));
          return Response.json({
            data: [{ b64_json: Buffer.from([255, 216, 255, 217]).toString("base64") }],
          });
        },
        fakeStorage as any,
      );
      assert.equal(calls, 1);
      assert.equal(storedBytes?.byteLength, 4);
      assert.equal(generated.coverId, fresh.id);
      assert.equal(
        (await first<any>("SELECT cover_id FROM drafts WHERE id=?", draft.id)).cover_id,
        null,
        "Generation must not silently attach or approve a cover",
      );
      await generateCover(
        { id: fresh.id, payload },
        async () => {},
        async () => {
          throw new Error("Must reuse saved cover");
        },
        fakeStorage as any,
      );
      await assert.rejects(
        () =>
          generateCover(
            { id: "interrupted", payload, attempts: 2 },
            async () => {},
            async () => {
              throw new Error("Must not bill automatically");
            },
            fakeStorage as any,
          ),
        /interrupted/,
      );
      const file = await coverBytes(BUILTIN_COVER);
      assert.equal(file.mime, "image/png");
      assert(file.bytes.length > 1000);
      const d = { ...draft, cover_id: BUILTIN_COVER };
      const html = await standaloneArticle(d);
      assert(html.includes('src="data:image/png;base64,'));
      assert(html.includes("AI-generated illustration"));
      const entries = await articleEntries(d, {
        id: "test-domain",
        host: "example.com",
        name: "Test",
        byline: "Editor",
        color: "#245bda",
      });
      assert(entries.some((e) => e.name === "cover.png" && e.bytes));
      assert(entries.find((e) => e.name === "index.html")?.text?.includes('src="cover.png"'));
      assert(
        entries
          .find((e) => e.name === "index.html")
          ?.text?.includes("https://example.com/test-article/cover.png"),
      );
      assert(entries.some((e) => e.name === "chart.svg"));
      assert(zip(entries).byteLength > file.bytes.length);
      assert.equal(
        (
          await first<any>(
            "SELECT rowsecurity FROM pg_tables WHERE schemaname='studio' AND tablename='editorial_covers'",
          )
        )?.rowsecurity,
        true,
      );
    });
  } finally {
    await pg.close();
    if (key === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = key;
  }
});
test("cover failures stop automatic retries; prompts contain no private title or row data", async () => {
  let terminal = false;
  await reportJobFailure(
    { id: "test", kind: "cover", attempts: 1 },
    "Generating cover illustration",
    new Error("API failed"),
    async (_job, _message, stop) => {
      terminal = !!stop;
    },
    () => {},
  );
  assert(terminal);
  assert(coverPrompt("truck").includes("no other vehicles"));
  assert(!coverPrompt("truck").includes("Dallas"));
});
