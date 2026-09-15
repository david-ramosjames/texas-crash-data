import type { Draft, Domain } from "./contracts";
import { coverBytes, hydrateCover } from "./covers";
import {
  assertEditorialReady,
  composeEditorial,
  COVER_CAPTION,
  editorialFacts,
  narrativeOnly,
  starterArticle,
} from "./editorial";
import { exportCSV, renderChart, renderPage } from "./export";
import type { ZipEntry } from "./zip";
export async function articleEntries(d: Draft, domain?: Domain): Promise<ZipEntry[]> {
  assertEditorialReady(d.body);
  const draft = await hydrateCover(d);
  const cover = draft.cover_id ? await coverBytes(draft.cover_id) : null;
  const coverName = cover ? `cover.${cover.ext}` : undefined;
  const entries: ZipEntry[] = [
    { name: "index.html", text: renderPage(draft, domain, false, coverName) },
    {
      name: "article.txt",
      text: `${draft.title}\n\n${composeEditorial(draft.body, draft.evidence)}`,
    },
    { name: "chart.svg", text: renderChart(draft, domain) },
    { name: "data.csv", text: exportCSV(draft) },
    {
      name: "newsletter.txt",
      text: `EVIDENCE-BASED ADAPTATION — review before sending\n\n${draft.title}\n\n${narrativeOnly(starterArticle(draft.evidence, "newsletter"))}\n\nSource: TxDOT public extract. Include the article link and its full methodology when sending.`,
    },
    {
      name: "social.txt",
      text: `EVIDENCE-BASED ADAPTATION — review before posting\n\n${editorialFacts(draft.evidence).scope}\n\n${editorialFacts(draft.evidence).row1 || ""}\n\nReported counts, not risk per trip. Source: TxDOT public extract. Add the published article link for the complete methods and data.`,
    },
    { name: "evidence.json", text: JSON.stringify(draft.evidence, null, 2) },
    {
      name: "README.txt",
      text: `Approved editorial export. Keep index.html and any cover image together. Chart values come directly from the saved evidence, not AI. Review labels and statistics before publication. ${cover ? COVER_CAPTION + "\nCover alt text: " + cover.alt : "No cover selected."}\nNothing has been published automatically.`,
    },
  ];
  if (cover && coverName) entries.push({ name: coverName, bytes: cover.bytes });
  return entries;
}
export async function standaloneArticle(d: Draft, domain?: Domain) {
  assertEditorialReady(d.body);
  const draft = await hydrateCover(d);
  const cover = draft.cover_id ? await coverBytes(draft.cover_id) : null;
  return renderPage(
    draft,
    domain,
    false,
    cover ? `data:${cover.mime};base64,${Buffer.from(cover.bytes).toString("base64")}` : undefined,
  );
}
