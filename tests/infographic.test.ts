import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import type { Draft } from "../lib/contracts";
import { graphicLines, infographicNotes, renderInfographic } from "../lib/infographic";
import { PUBLICATION_PROFILES } from "../lib/publication-profiles";
import { articleEntries } from "../lib/editorial-package";

const draft: Draft = {
  id: "test",
  title: "Reported truck crashes in Example City",
  slug: "example",
  channel: "page",
  status: "approved",
  body: "Synthetic fixture.",
  created: "2026-09-15",
  updated: "2026-09-15",
  evidence: {
    spec: {
      cohort: "truck",
      group: "road",
      metric: "crashes",
      city: "Example City",
      start: "2024-01-01",
      end: "2024-12-31",
      min: 5,
      limit: 10,
    },
    rows: Array.from({ length: 7 }, (_, i) => ({
      label: `Road ${i + 1}`,
      crashes: 100 - i * 10,
      severe: 12,
      fatal: 3,
      deaths: 4,
      serious: 9,
    })),
    total: 1000,
    severe: 60,
    fatal: 20,
    unlocated: 7,
    excluded: 0,
    warnings: [],
    sources: [],
    generated: "2026-09-15",
    engine: "Synthetic fixture",
    sql: "SELECT 1",
    parameters: [],
  },
};
test("infographic uses the selected publication and saved counts, not AI or summed rankings", async () => {
  const original = JSON.stringify(draft);
  for (const domain of PUBLICATION_PROFILES) {
    const svg = renderInfographic(draft, domain);
    assert(svg.includes(domain.name));
    assert(svg.includes(domain.color));
    assert(svg.includes("1,000"));
    assert(svg.includes("5 of 7 returned groups"));
    assert(svg.includes("2024-01-01"));
    assert(svg.includes("not risk per trip or mile"));
    assert(svg.includes("FULL FILTERED COHORT"));
    assert(!svg.includes("6. Road 6"));
    assert(!svg.includes("REVIEW COPY"));
    assert(!svg.includes("<image") && !svg.includes("<script") && !svg.includes("<foreignObject"));
  }
  assert(renderInfographic(draft, undefined, true).includes("REVIEW COPY"));
  const entries = await articleEntries(draft, PUBLICATION_PROFILES[0]);
  assert.equal(
    entries.find((e) => e.name === "infographic.svg")?.text,
    renderInfographic(draft, PUBLICATION_PROFILES[0]),
  );
  assert(
    entries.find((e) => e.name === "infographic-methodology.txt")?.text?.includes("Query filters:"),
  );
  assert.equal(JSON.stringify(draft), original);
});
test("graphic guards stale hours and invalid counts, handles zeros and comparison focus honestly", () => {
  assert.throws(
    () =>
      renderInfographic({
        ...draft,
        evidence: { ...draft.evidence, spec: { ...draft.evidence.spec, group: "hour" } },
      }),
    /AM\/PM/,
  );
  assert.throws(
    () => renderInfographic({ ...draft, evidence: { ...draft.evidence, total: NaN } }),
    /invalid counts/,
  );
  const zero = renderInfographic({
    ...draft,
    evidence: { ...draft.evidence, total: 0, severe: 0, fatal: 0, rows: [] },
  });
  assert(zero.includes("No returned groups"));
  assert(!zero.includes("Infinity") && !zero.includes("NaN"));
  const focused = renderInfographic({
    ...draft,
    evidence: {
      ...draft.evidence,
      comparison: {
        focusLabel: "Road 2",
        start: "2023-01-01",
        end: "2023-12-31",
        rows: [],
        total: 0,
        caveat: "Comparison unavailable",
      },
    },
  });
  assert(focused.includes("1 of 1 returned groups"));
  assert(focused.includes("Current period only"));
  assert(!focused.includes("1. Road 1"));
  assert(!focused.includes("100% decrease"));
});
test("SVG escapes arbitrary strings, wraps long labels, and preserves complete methodology", () => {
  const label = "WW".repeat(160) + " <script>alert(1)</script>";
  const long = {
    ...draft,
    title: "WW".repeat(300),
    evidence: {
      ...draft.evidence,
      rows: [{ ...draft.evidence.rows[0], label }],
      spec: { ...draft.evidence.spec, weather: "Rain", hourFrom: 12, hourThrough: 17 },
      timeVersion: 2,
    },
  };
  const svg = renderInfographic(long);
  assert(!svg.includes("<script>"));
  assert(svg.includes("&lt;script&gt;"));
  assert(svg.includes("hourFrom: 12"));
  assert(svg.includes("weather: Rain"));
  assert(infographicNotes(long).includes('"hourFrom":12'));
  const lines = graphicLines("W".repeat(300), 1072, 48);
  assert(lines.length > 10);
  assert(lines.every((line) => line.length * 48 * 0.95 <= 1072));
  assert(Number(svg.match(/height="(\d+)"/)![1]) < 8000);
});
test("infographic downloads remain behind existing authentication and approval gate", async () => {
  const route = await readFile(new URL("../app/api/[...path]/route.ts", import.meta.url), "utf8");
  assert(route.indexOf("const user = await getUser()") < route.indexOf("format === 'infographic'"));
  assert(
    route.indexOf("if (!['approved', 'exported'].includes(draft.status))") <
      route.indexOf("format === 'infographic'"),
  );
  assert(
    route.indexOf("assertFreshTime(draft.evidence)") < route.indexOf("format === 'infographic'"),
  );
  const panel = await readFile(
    new URL("../components/infographic-panel.tsx", import.meta.url),
    "utf8",
  );
  assert(panel.includes("!dirty"));
  assert(panel.includes("format=infographic"));
  assert(panel.includes("URL.revokeObjectURL"));
});
