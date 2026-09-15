// Local layout QA only. Synthetic data; no database or API credentials used.
import { createServer } from "node:http";
import { standaloneArticle } from "../lib/editorial-package";
import { BUILTIN_COVER, starterArticle } from "../lib/editorial";
import type { Evidence, Draft } from "../lib/contracts";
import { PUBLICATION_PROFILES } from "../lib/publication-profiles";
const evidence: Evidence = {
  spec: {
    cohort: "truck",
    group: "road",
    metric: "crashes",
    start: "2024-01-01",
    end: "2024-12-31",
    city: "EXAMPLE CITY",
    min: 10,
    limit: 10,
  },
  total: 200,
  severe: 20,
  fatal: 5,
  unlocated: 10,
  excluded: 0,
  rows: [
    {
      label: "EXAMPLE CITY · EXAMPLE FREEWAY",
      crashes: 120,
      severe: 12,
      fatal: 3,
      deaths: 4,
      serious: 10,
    },
    {
      label: "EXAMPLE CITY · SAMPLE ROAD",
      crashes: 80,
      severe: 8,
      fatal: 2,
      deaths: 2,
      serious: 7,
    },
  ],
  warnings: ["Synthetic layout fixture — not real crash findings."],
  sources: [],
  generated: "2026-09-15T12:00:00Z",
  engine: "Layout test only",
  sql: "SELECT 1",
  parameters: [],
};
const draft: Draft = {
  id: "preview",
  title: "A closer look at reported truck crashes: layout preview",
  slug: "preview",
  channel: "page",
  status: "draft",
  body: starterArticle(evidence, "page"),
  cover_id: BUILTIN_COVER,
  evidence,
  created: "2026-09-15",
  updated: "2026-09-15",
};
const pages = await Promise.all(
  PUBLICATION_PROFILES.map(
    async (domain) => [domain.host, await standaloneArticle(draft, domain)] as const,
  ),
);
createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  const host = new URL(req.url || "/", "http://127.0.0.1:3210").pathname.slice(1);
  res.end(
    pages.find(([name]) => name === host)?.[1] ||
      `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Publication template previews</title></head><body style="font:18px/1.8 system-ui;max-width:800px;margin:60px auto;padding:24px"><h1>Publication template previews</h1><p>Synthetic layout examples only — not real crash findings.</p><ul>${PUBLICATION_PROFILES.map((p) => `<li><a href="/${p.host}">${p.name}</a>${p.host === "findaustinlawyer.com" ? " — provisional design" : ""}</li>`).join("")}</ul></body></html>`,
  );
}).listen(3210, "127.0.0.1", () =>
  console.log("Synthetic editorial preview: http://127.0.0.1:3210"),
);
