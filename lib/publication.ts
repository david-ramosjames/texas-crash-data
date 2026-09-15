import type { Draft, Domain } from "./contracts";
import { number, titleCase } from "./contracts";
import {
  COVER_CAPTION,
  editorialMethods,
  editorialRows,
  metricLabel,
  narrativeOnly,
  roadNameWarnings,
} from "./editorial";
import { escapeHTML as esc } from "./export";
import { publicationTheme } from "./publication-profiles";
import { applyPublicationTemplate } from "./publication-template";

function paragraphs(body: string) {
  return body
    .split(/\n\s*\n/)
    .filter(Boolean)
    .map((block) => {
      if (/^##\s/.test(block)) return `<h2>${esc(block.replace(/^##\s*/, ""))}</h2>`;
      if (/^- /.test(block))
        return `<ul>${block
          .split("\n")
          .map((line) => `<li>${esc(line.replace(/^- /, ""))}</li>`)
          .join("")}</ul>`;
      return `<p>${esc(block).replace(/\n/g, "<br>")}</p>`;
    })
    .join("");
}
export function renderChart(d: Draft, domain?: Domain) {
  const e = d.evidence,
    rows = editorialRows(e).slice(0, 10),
    max = Math.max(1, ...rows.map((r) => r[e.spec.metric]));
  const height = 230 + rows.length * 66,
    color = publicationTheme(domain).color;
  const title = `${metricLabel(e.spec.metric)} by ${e.spec.group}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${height}" viewBox="0 0 1200 ${height}" role="img" aria-labelledby="title desc"><title id="title">${esc(title)}</title><desc id="desc">${esc(e.spec.start)} to ${esc(e.spec.end)}. Reported counts, not risk per trip. ${rows.map((r) => esc(r.label) + ": " + r[e.spec.metric]).join("; ")}</desc><rect width="1200" height="${height}" fill="#ffffff"/><rect width="1200" height="8" fill="${color}"/><g font-family="Arial,sans-serif" fill="#142c43"><text x="48" y="57" font-size="17" letter-spacing="2">${esc(domain?.name || "TEXAS CRASH RESEARCH")}</text><text x="48" y="104" font-size="30" font-weight="700">${esc(titleCase(title))}</text><text x="48" y="138" font-size="19" fill="#526779">${esc(e.spec.city || "Texas")} · ${e.spec.start} — ${e.spec.end}</text>${rows
    .map((r, i) => {
      const y = 184 + i * 66;
      return `<text x="48" y="${y}" font-size="18">${esc(titleCase(r.label).length > 62 ? titleCase(r.label).slice(0, 59) + "…" : titleCase(r.label))}</text><rect x="48" y="${y + 12}" width="1000" height="14" rx="4" fill="#edf1f5"/><rect x="48" y="${y + 12}" width="${(1000 * r[e.spec.metric]) / max}" height="14" rx="4" fill="${color}"/><text x="1148" y="${y + 23}" text-anchor="end" font-size="21" font-weight="700">${number(r[e.spec.metric])}</text>`;
    })
    .join(
      "",
    )}<text x="48" y="${height - 32}" font-size="17" fill="#526779">Source: TxDOT public extract · Returned groups only · Counts are not exposure-adjusted risk</text></g></svg>`;
}
export function renderPublication(d: Draft, domain?: Domain, preview = false, coverSrc?: string) {
  return applyPublicationTemplate(
    renderBasePublication(d, domain, preview, coverSrc),
    domain,
    preview,
  );
}
function renderBasePublication(d: Draft, domain?: Domain, preview = false, coverSrc?: string) {
  const e = d.evidence,
    rows = editorialRows(e),
    lead = rows[0];
  const color = /^#[0-9a-f]{6}$/i.test(domain?.color || "") ? domain!.color : "#245bda";
  const canonical = domain ? `https://${domain.host}/${d.slug}/` : null;
  const image = coverSrc || d.cover?.url;
  const safeImage =
    image &&
    /^(?:data:image\/(?:png|jpeg);base64,[a-z0-9+/=]+|\/?(?:api\/covers\/|editorial\/)[a-z0-9./-]+|cover\.(?:jpg|png))$/i.test(
      image,
    )
      ? image
      : undefined;
  const body = narrativeOnly(d.body),
    methods = editorialMethods(e),
    aliases = roadNameWarnings(e);
  const description = body
    .replace(/^## .*$/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 155);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(d.title)}</title><meta name="description" content="${esc(description)}">${preview ? '<meta name="robots" content="noindex,nofollow">' : ""}${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ""}<meta property="og:title" content="${esc(d.title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:type" content="article">${canonical && safeImage?.startsWith("cover.") ? `<meta property="og:image" content="${esc(canonical + safeImage)}"><meta property="og:image:alt" content="${esc(d.cover?.alt || COVER_CAPTION)}">` : ""}<style>
  :root{--brand:${color}}*{box-sizing:border-box}body{margin:0;color:#183047;background:#fbfaf7;font:18px/1.75 system-ui,sans-serif}header{border-top:5px solid var(--brand);border-bottom:1px solid #dbe2e7;padding:20px 5vw;font-weight:750;background:#fff}main{max-width:1120px;margin:auto;padding:55px 28px}.eyebrow{font-size:12px;font-weight:750;letter-spacing:.16em;color:var(--brand);text-transform:uppercase}h1{font-size:clamp(32px,4.8vw,57px);line-height:1.12;letter-spacing:-.045em;max-width:1000px;margin:14px 0 23px}h2{font-size:27px;line-height:1.25;letter-spacing:-.025em;margin:42px 0 16px}.meta,figcaption{color:#586c7d;font-size:13px}.hero{margin:32px 0}.hero img{display:block;width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:8px}figcaption{margin-top:10px}.kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:#dbe2e7;border:1px solid #dbe2e7;border-radius:8px;overflow:hidden;margin:34px 0}.kpi{padding:24px;background:#fff}.kpi strong{font-size:34px;display:block;letter-spacing:-.04em}.kpi span{font-size:13px;color:#526779}.story{max-width:760px;margin:38px auto}.story p{margin:0 0 23px}.story p:first-child{font-size:21px}.caveat{border-left:3px solid var(--brand);background:#eef3f8;padding:18px 22px;font-size:15px;margin:30px 0}.chart{background:white;border:1px solid #dbe2e7;border-radius:8px;overflow:hidden}.chart svg{display:block;width:100%;height:auto}.scroll{overflow:auto}table{width:100%;border-collapse:collapse;font-size:14px;background:#fff}th,td{text-align:left;padding:13px 12px;border-bottom:1px solid #dbe2e7}th{background:#edf2f6;white-space:nowrap}td:not(:first-child){font-variant-numeric:tabular-nums}details{margin-top:28px;border-top:1px solid #dbe2e7;padding-top:20px}summary{font-weight:700;cursor:pointer}details li{margin:12px 0;font-size:15px}pre{font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere}footer{margin-top:45px;border-top:1px solid #dbe2e7;padding-top:22px;font-size:13px;color:#586c7d}a{color:var(--brand)}@media(max-width:620px){main{padding:30px 18px}.kpis{grid-template-columns:1fr}.kpi{padding:14px 20px}.kpi strong{font-size:28px}}@media print{body{background:white}main{padding:0}.hero img{max-height:260px}details{display:block}}
  </style></head><body><header>${esc(domain?.name || "Texas Crash Research")}</header><main><div class="eyebrow">Independent analysis · TxDOT public records</div><h1>${esc(d.title)}</h1><p class="meta">${esc(domain?.byline || "Research team")} · Data period: ${e.spec.start} — ${e.spec.end}<br>Evidence snapshot: ${esc(e.generated.slice(0, 10))} · ${e.sources.length} supplied source batches</p>${safeImage ? `<figure class="hero"><img src="${esc(safeImage)}" alt="${esc(d.cover?.alt || COVER_CAPTION)}"><figcaption>${COVER_CAPTION}</figcaption></figure>` : ""}<div class="kpis"><div class="kpi"><strong>${number(e.total)}</strong><span>Matching reported crashes · full filtered cohort</span></div><div class="kpi"><strong>${number(e.severe)}</strong><span>Fatal or suspected serious-injury crashes · full cohort</span></div><div class="kpi"><strong>${number(e.fatal)}</strong><span>Fatal crashes · full filtered cohort</span></div></div><aside class="caveat">These are reported crash counts, not the risk per trip or mile. Supplied extraction intervals do not guarantee complete reporting.</aside><article class="story">${paragraphs(body)}</article>${aliases.length ? `<aside class="caveat"><strong>Road-name review</strong>${aliases.map((a) => `<p>${esc(a)}</p>`).join("")}</aside>` : ""}<h2>The numbers at a glance</h2><p class="meta">${rows.length} returned groups, ranked by ${esc(metricLabel(e.spec.metric))}. ${lead ? "The chart displays up to the first ten returned groups." : ""} These labels have not been merged into verified corridors.</p><div class="chart">${renderChart(d, domain)}</div><h2>Verified statistics</h2><div class="scroll"><table><thead><tr><th>${esc(e.spec.group)}</th><th>Reported crashes</th><th>Fatal / suspected serious-injury crashes</th><th>Fatal crashes</th><th>Deaths (people)</th><th>Suspected serious injuries (people)</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(titleCase(r.label))}</td><td>${number(r.crashes)}</td><td>${number(r.severe)}</td><td>${number(r.fatal)}</td><td>${number(r.deaths)}</td><td>${number(r.serious)}</td></tr>`).join("")}</tbody></table></div><details open><summary>Methods, definitions and limitations</summary><ul>${methods.map((m) => `<li>${esc(m)}</li>`).join("")}</ul></details><details><summary>Reproduce this research</summary><pre>${esc(JSON.stringify({ spec: e.spec, sources: e.sources, generated: e.generated, sql: e.sql, parameters: e.parameters }, null, 2))}</pre></details><footer>Source: <a href="https://www.txdot.gov/data-maps/crash-reports-records/crash-data-analysis-statistics.html">Texas Department of Transportation public crash data</a>. Independent analysis, not affiliated with or endorsed by TxDOT. No individual crash participants are identified. Nothing on this page establishes legal fault.</footer></main></body></html>`;
}
