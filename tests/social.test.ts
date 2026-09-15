import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { Draft } from "../lib/contracts";
import { socialDesign, socialCaption, renderSocialCard } from "../lib/social";
import { socialEntries } from "../lib/social-package";
import { referenceMime, storeReference, referenceImage } from "../lib/social-reference";
import { withConnection, run, first } from "../lib/db";
import { PUBLICATION_PROFILES } from "../lib/publication-profiles";
import { APPENDIX, BUILTIN_COVER } from "../lib/editorial";

const draft: Draft = {
  id: "social-test",
  title: "Synthetic test",
  slug: "synthetic",
  channel: "social",
  status: "approved",
  body: `A closer look at reported truck crashes.\n\n${APPENDIX}\nPrivate review appendix.`,
  created: "2026-09-15",
  updated: "2026-09-15",
  cover_id: BUILTIN_COVER,
  evidence: {
    spec: {
      cohort: "truck",
      group: "road",
      metric: "crashes",
      start: "2024-01-01",
      end: "2024-12-31",
      min: 5,
      limit: 10,
    },
    rows: [
      {
        label: "Example City · Example Freeway",
        crashes: 120,
        severe: 12,
        fatal: 3,
        deaths: 4,
        serious: 9,
      },
      { label: "Other Road", crashes: 80, severe: 4, fatal: 1, deaths: 1, serious: 3 },
    ],
    total: 200,
    severe: 16,
    fatal: 4,
    unlocated: 0,
    excluded: 0,
    warnings: [],
    sources: [],
    generated: "2026-09-15",
    engine: "Fixture",
    sql: "SELECT 1",
    parameters: [],
  },
};
test("social settings validate links, layout and bounded reference notes", () => {
  assert.equal(socialDesign().style, "photo");
  for (const raw of [
    "null",
    "[]",
    '{"style":"other"}',
    '{"carousel":"yes"}',
    '{"articleUrl":"javascript:alert(1)"}',
    '{"articleUrl":"https://user:pass@example.com"}',
  ])
    assert.throws(() => socialDesign(raw));
  assert.throws(() => socialDesign(JSON.stringify({ headline: "x".repeat(181) })));
  assert.equal(socialDesign('{"articleUrl":"htt"}', false).articleUrl, "htt");
  assert.equal(
    socialDesign('{"articleUrl":"https://example.com/story/"}').articleUrl,
    "https://example.com/story/",
  );
});
test("social cards preserve saved evidence, branding, privacy and illustration disclosure", () => {
  const original = JSON.stringify(draft);
  for (const style of ["photo", "statistic", "chart"])
    for (const domain of PUBLICATION_PROFILES) {
      const d = {
        ...draft,
        social_json: JSON.stringify({
          style,
          carousel: true,
          referenceNotes: "SECRET REFERENCE NOTES",
        }),
      };
      for (let slide = 0; slide < 3; slide++) {
        const svg = renderSocialCard(d, domain, "data:image/png;base64,AA==", slide, true);
        assert(svg.includes(domain.name));
        assert(svg.includes(domain.color));
        assert(svg.includes("2024-01-01"));
        assert(svg.includes("REVIEW COPY"));
        assert(!svg.includes("SECRET REFERENCE NOTES"));
        assert(!svg.includes("Private review appendix"));
        assert(!svg.includes("NaN"));
        if (style === "photo" && slide === 0) assert(svg.includes("NOT AN ACTUAL CRASH"));
        if (slide === 1) assert(svg.includes("DO NOT SUM GROUP COUNTS"));
      }
    }
  assert.equal(JSON.stringify(draft), original);
  assert.throws(
    () => renderSocialCard(draft, undefined, "https://example.com/image.jpg"),
    /illustration/,
  );
  assert.throws(
    () =>
      renderSocialCard({
        ...draft,
        evidence: { ...draft.evidence, spec: { ...draft.evidence.spec, group: "hour" } },
      }),
    /fresh hour/,
  );
  assert.throws(
    () =>
      renderSocialCard({
        ...draft,
        evidence: { ...draft.evidence, rows: [{ ...draft.evidence.rows[0], crashes: -1 }] },
      }),
    /counts/,
  );
  const escaped = renderSocialCard(
    { ...draft, social_json: JSON.stringify({ headline: "<script>alert(1)</script>" }) },
    undefined,
    "data:image/png;base64,AA==",
  );
  assert(!escaped.includes("<script>"));
  assert(escaped.includes("&lt;script&gt;"));
});
test("social exports are captions and standalone images, never a web page or reference board", async () => {
  const d = {
    ...draft,
    social_json: JSON.stringify({
      carousel: true,
      articleUrl: "https://example.com/story/",
      referenceNotes: "DO NOT EXPORT",
    }),
  };
  const caption = socialCaption(d);
  assert(caption.includes("https://example.com/story/"));
  assert(!caption.includes(APPENDIX));
  assert(caption.includes("2024-12-31"));
  const files = await socialEntries(d, PUBLICATION_PROFILES[0]);
  assert.equal(files.filter((f) => f.name.endsWith(".svg")).length, 3);
  assert(!files.some((f) => f.name.endsWith(".html")));
  assert(files.find((f) => f.name === "social-1.svg")?.text?.includes("data:image/png;base64,"));
  assert(files.some((f) => f.name === "methodology.txt"));
  assert(files.some((f) => f.name === "evidence.json"));
  assert(!JSON.stringify(files).includes("DO NOT EXPORT"));
  const route = await readFile(new URL("../app/api/[...path]/route.ts", import.meta.url), "utf8");
  assert(
    route.indexOf("const user = await getUser()") < route.indexOf("area==='social-reference'"),
  );
  assert(
    route.indexOf("if (!['approved', 'exported'].includes(draft.status))") <
      route.indexOf("format==='social-image'"),
  );
});
test("references persist privately, reject invalid bytes, and stay scoped to their draft", async () => {
  const pg = new PGlite();
  try {
    for (const file of ["001_core.sql", "010_social_posts.sql"])
      await pg.exec(await readFile(new URL("../migrations/" + file, import.meta.url), "utf8"));
    const bytes = new Uint8Array(24);
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
    new DataView(bytes.buffer).setUint32(16, 100);
    new DataView(bytes.buffer).setUint32(20, 100);
    assert.equal(referenceMime(bytes), "image/png");
    assert.throws(() => referenceMime(new Uint8Array(30)));
    const stored = new Map<string, ArrayBuffer>();
    const storage = {
      put: async (key: string, data: ArrayBuffer) => {
        stored.set(key, data);
      },
      head: async () => null,
      get: async (key: string) => ({ body: new Response(stored.get(key)).body! }),
    };
    await withConnection(
      {
        query: async (sql, args) => {
          const r = await pg.query(sql, args);
          return { ...r, rowCount: r.affectedRows };
        },
      },
      async () => {
        for (const [id, channel] of [
          ["social-test", "social"],
          ["page-test", "page"],
          ["other-social", "social"],
        ])
          await run(
            "INSERT INTO drafts(id,title,slug,channel,body,evidence,created,updated) VALUES(?,?,?,?,?,?,?,?)",
            id,
            "Test",
            id,
            channel,
            "Caption",
            "{}",
            draft.created,
            draft.updated,
          );
        const uploaded = await storeReference(
          draft.id,
          new Request("http://localhost", { method: "POST", body: bytes }),
          storage,
        );
        assert.equal(
          (await first<any>("SELECT social_reference_id FROM drafts WHERE id=?", draft.id))
            .social_reference_id,
          uploaded.id,
        );
        assert.equal((await referenceImage(draft.id, storage)).mime, "image/png");
        await assert.rejects(
          () =>
            storeReference(
              "page-test",
              new Request("http://localhost", { method: "POST", body: bytes }),
              storage,
            ),
          /social draft/,
        );
        await run(
          "UPDATE drafts SET social_reference_id=? WHERE id=?",
          uploaded.id,
          "other-social",
        );
        await assert.rejects(() => referenceImage("other-social", storage), /No reference/);
        await run("UPDATE drafts SET social_reference_id=NULL WHERE id=?", draft.id);
        assert.equal(stored.size, 1);
        assert(await first("SELECT id FROM social_references WHERE id=?", uploaded.id));
        assert.equal(
          (
            await pg.query<any>(
              "SELECT relrowsecurity FROM pg_class WHERE oid='studio.social_references'::regclass",
            )
          ).rows[0].relrowsecurity,
          true,
        );
      },
    );
  } finally {
    await pg.close();
  }
});
