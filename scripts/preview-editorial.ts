// Local layout QA only. Synthetic data; no database or API credentials used.
import { createServer } from "node:http";
import { standaloneArticle } from "../lib/editorial-package";
import { BUILTIN_COVER, starterArticle } from "../lib/editorial";
import type { Evidence, Draft } from "../lib/contracts";
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
const html = await standaloneArticle(draft, {
  id: "preview",
  host: "example.com",
  name: "SYNTHETIC DATA · LAYOUT TEST",
  byline: "Preview only",
  color: "#245bda",
});
createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  res.end(html);
}).listen(3210, "127.0.0.1", () =>
  console.log("Synthetic editorial preview: http://127.0.0.1:3210"),
);
