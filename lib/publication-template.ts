import type { Domain, Draft } from "./contracts";
import { publicationTheme } from "./publication-profiles";
import { escapeHTML as esc } from "./export";

// Styles are bundled into the export, with no remote font, CSS, script or tracker dependencies.
// Licensed brand fonts are preferred when installed by the destination site; offline exports use fallbacks.
function styles(domain?: Domain) {
  const t = publicationTheme(domain);
  return `
  :root{--brand:${t.color};--ink:${t.ink};--accent:${t.accent};--soft:${t.soft}}
  body{font-family:${t.font};background:#fff;color:var(--ink)}
  h1,h2,.publication-wordmark{font-family:${t.heading}}h1{overflow-wrap:anywhere}
  a{color:var(--brand)}a:focus-visible,summary:focus-visible{outline:3px solid var(--accent);outline-offset:5px}
  .publication-header{border-top:5px solid var(--accent);padding:24px max(24px,calc((100vw - 1120px)/2));display:flex;gap:24px;align-items:center;justify-content:space-between;background:#fff;color:var(--ink)}
  .publication-wordmark{display:block;font-size:27px;font-weight:700;line-height:1.2;letter-spacing:-.035em;text-decoration:none;color:inherit}
  .publication-subtitle{display:block;font:700 12px/1.5 ${t.font};letter-spacing:.16em;text-transform:uppercase;margin-top:6px}
  .publication-nav{display:flex;flex-wrap:wrap;gap:20px;font-size:14px;font-weight:600}
  .publication-nav a{color:inherit;text-decoration:none}.publication-nav a:hover{text-decoration:underline}
  .publication-header + main{padding-top:48px}.eyebrow{color:var(--ink);font-size:13px}
  h1{font-weight:600;letter-spacing:-.035em}h2{font-size:30px;font-weight:600}
  .meta,figcaption{font-size:14px}.meta{max-width:780px}
  .kpis{border:0;border-radius:0;background:transparent;gap:16px}.kpi{background:var(--soft);border-top:3px solid var(--accent);padding:25px}.kpi span{font-size:14px;color:var(--ink)}
  .caveat{background:var(--soft);color:var(--ink)}.hero img{border-radius:0}
  .story{max-width:780px}.story h2{border-bottom:1px solid #dbe2e7;padding-bottom:14px}
  .chart{border-radius:0}th{background:var(--soft);color:var(--ink)}details{scroll-margin-top:20px}
  .publication-footer{border-top:3px solid var(--accent);background:var(--soft);padding:30px max(24px,calc((100vw - 1064px)/2));margin:36px 0 0;color:var(--ink);display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap;font-size:14px}
  .publication-footer strong{display:block;font-size:18px}.publication-footer p{margin:8px 0 0;max-width:720px}
  .publication-footer a{color:inherit}.publication-footer .footer-home{align-self:center;font-weight:600}
  .template-warning{background:#fff5da;color:#624400;border:1px solid #e0c784;padding:14px 20px;font:14px/1.5 system-ui;margin:0}
  body[data-publication="trucking-chicas"] .publication-header{background:#121212;color:#fff;border-bottom:0}
  body[data-publication="trucking-chicas"] .publication-wordmark{text-transform:uppercase;font-weight:800;letter-spacing:.035em}
  body[data-publication="trucking-chicas"] h1{font-weight:800;max-width:1000px}
  body[data-publication="trucking-chicas"] .kpi{background:#121212;color:#fff}
  body[data-publication="trucking-chicas"] .kpi span{color:#f3e8d9}
  body[data-publication="trucking-chicas"] .publication-footer{background:#121212;color:#fff}
  body[data-publication="ramos-james"] h1{font-weight:400;font-size:clamp(34px,5.2vw,62px);line-height:1.13;max-width:960px}
  body[data-publication="ramos-james"] .eyebrow::before{content:"";display:inline-block;width:36px;height:3px;vertical-align:middle;background:var(--accent);margin-right:12px}
  body[data-publication="ramos-james"] .publication-subtitle{color:#526779}
  body[data-publication="ramos-james"] .hero{margin-top:42px}
  body[data-publication="find-austin-lawyer"] .publication-header{border-bottom:2px solid var(--ink)}
  body[data-publication="find-austin-lawyer"] .eyebrow{text-align:center}
  body[data-publication="find-austin-lawyer"] h1{text-align:center;margin-left:auto;margin-right:auto}
  body[data-publication="find-austin-lawyer"] main>.meta{text-align:center;margin-left:auto;margin-right:auto}
  .publication-index{max-width:1120px;margin:auto;padding:48px 28px}.publication-index h1{margin:18px 0;font-size:clamp(32px,5vw,58px)}
  .publication-articles{list-style:none;padding:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}
  .publication-articles li{border-top:3px solid var(--accent);background:var(--soft);padding:28px;min-width:0}
  .publication-articles h2{margin:0 0 18px;font-size:26px;line-height:1.3;overflow-wrap:anywhere}.publication-articles a{text-decoration:none}.publication-articles a:hover{text-decoration:underline}
  .publication-articles p{font-size:14px;margin:0}.publication-index .index-note{max-width:780px}
  @media(max-width:700px){.publication-header{align-items:flex-start;flex-direction:column;gap:18px;padding:20px}.publication-nav{gap:16px}.publication-wordmark{font-size:25px}.publication-header + main{padding-top:30px}.kpis,.publication-articles{grid-template-columns:1fr}.publication-footer{padding:24px 20px}.publication-index{padding:28px 18px}.publication-articles li{padding:22px}h2{font-size:26px}}
  @media print{.publication-nav,.footer-home,.template-warning{display:none}.publication-header,.publication-footer{background:white!important;color:#111!important}.kpi{background:#fff!important;color:#111!important}.kpi span{color:#111!important}}
  `;
}

function homeUrl(domain?: Domain) {
  return domain && /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain.host)
    ? `https://${domain.host}/`
    : undefined;
}

export function applyPublicationTemplate(
  html: string,
  domain?: Domain,
  preview = false,
  index = false,
) {
  const theme = publicationTheme(domain),
    home = homeUrl(domain);
  const name = esc(domain?.name || "Texas Crash Research");
  const wordmark = home
    ? `<a class="publication-wordmark" href="${esc(home)}">${name}</a>`
    : `<span class="publication-wordmark">${name}</span>`;
  const header = `<header class="publication-header"><div>${wordmark}<span class="publication-subtitle">Texas crash research</span></div>${index ? "" : '<nav class="publication-nav" aria-label="Article sections"><a href="#article">Article</a><a href="#statistics">Statistics</a><a href="#methods">Methodology</a></nav>'}</header>`;
  const warning =
    preview && theme.provisional
      ? '<p class="template-warning" role="status">Provisional Find Austin Lawyer design — verify against the live site before publishing.</p>'
      : "";
  const footer = `<footer class="publication-footer"><div><strong>${name}</strong><p>Research based on TxDOT public crash records. For general information; not legal advice. Reading this article does not create an attorney-client relationship.</p></div>${home ? `<a class="footer-home" href="${esc(home)}">Visit ${esc(domain!.host)}</a>` : ""}</footer>`;
  return html
    .replace("</head>", `<style>${styles(domain)}</style></head>`)
    .replace("<body>", `<body data-publication="${theme.key}">${warning}`)
    .replace(/<header>[\s\S]*?<\/header>/, header)
    .replace('<article class="story">', '<article class="story" id="article">')
    .replace("<h2>Verified statistics</h2>", '<h2 id="statistics">Verified statistics</h2>')
    .replace("<details open>", '<details open id="methods">')
    .replace("</body>", `${footer}</body>`);
}

export function renderPublicationIndex(drafts: Draft[], domain: Domain) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(domain.name)} · Crash research</title><style>*{box-sizing:border-box}body{margin:0;font:18px/1.7 system-ui,sans-serif}</style></head><body><header></header><main class="publication-index"><div class="eyebrow">Texas crash research</div><h1>Research &amp; findings</h1><p class="index-note">Reported crash patterns from Texas Department of Transportation public records. Each article includes its data period, verified statistics and methodology. Counts are not risk per trip or mile.</p><ul class="publication-articles">${drafts.map((d) => `<li><h2><a href="./${esc(encodeURIComponent(d.slug))}/">${esc(d.title)}</a></h2><p>Data period: ${esc(d.evidence.spec.start)} — ${esc(d.evidence.spec.end)}</p><p>${esc(domain.byline)}</p></li>`).join("")}</ul></main></body></html>`;
  return applyPublicationTemplate(html, domain, false, true);
}
