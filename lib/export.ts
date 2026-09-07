import type { Draft, Domain } from './contracts';
export const escapeHTML = (s: unknown) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
export function renderPage(d: Draft, domain?: Domain, preview = false) {
  const e = d.evidence;
  const color = domain?.color || '#245bda';
  const title = escapeHTML(d.title),
    canonical = domain ? `https://${domain.host}/${d.slug}/` : null;
  const lead = e.rows[0];
  const max = Math.max(1, ...e.rows.map((r) => r[e.spec.metric]));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><meta name="description" content="${escapeHTML(d.body.slice(0, 155).replace(/\n/g, ' '))}">${preview ? '<meta name="robots" content="noindex,nofollow">' : ''}${canonical ? `<link rel="canonical" href="${escapeHTML(canonical)}">` : ''}<meta property="og:title" content="${title}"><meta property="og:type" content="article"><style>:root{--brand:${color}}*{box-sizing:border-box}body{margin:0;color:#172c42;background:#fff;font:17px/1.7 system-ui,sans-serif}header{border-top:6px solid var(--brand);border-bottom:1px solid #e0e7ee;padding:20px 7vw;font-weight:700}main{max-width:860px;margin:auto;padding:55px 24px}h1{font-size:clamp(28px,5vw,46px);line-height:1.14;letter-spacing:-.04em}h2{font-size:23px;margin-top:38px}.meta{color:#58718a;font-size:14px}.callout{border-left:4px solid var(--brand);background:#f0f4f9;padding:20px;margin:30px 0}.bar{display:grid;grid-template-columns:minmax(100px,1fr) 2fr 60px;gap:12px;align-items:center;margin:13px 0;font-size:14px}.track{background:#edf1f6;height:15px;border-radius:3px}.fill{height:100%;background:var(--brand);border-radius:3px}.text{white-space:pre-wrap;overflow-wrap:anywhere}table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:12px;border-bottom:1px solid #dbe3ed}th{background:#f4f6fa}footer{margin-top:40px;border-top:1px solid #dde4ed;padding-top:20px;font-size:13px;color:#61778d}a{color:var(--brand)}details{margin-top:24px}pre{font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere}.scroll{overflow:auto}@media print{header{padding:0}main{padding:20px}details{display:none}}</style></head><body><header>${escapeHTML(domain?.name || 'Texas Crash Research')}</header><main><p class="meta">${escapeHTML(domain?.byline || 'Research team')} · Data: ${e.spec.start} – ${e.spec.end}</p><h1>${title}</h1><div class="callout"><strong>${e.total.toLocaleString('en-US')} matching reported crashes.</strong> ${escapeHTML(e.warnings[0])}</div><h2>Recorded crash counts</h2>${e.rows
    .slice(0, 10)
    .map(
      (r) =>
        `<div class="bar"><span>${escapeHTML(r.label)}</span><div class="track"><div class="fill" style="width:${(100 * r[e.spec.metric]) / max}%"></div></div><strong>${r[e.spec.metric].toLocaleString('en-US')}</strong></div>`,
    )
    .join(
      '',
    )}<p class="meta">Ranking metric: ${e.spec.metric === 'severe' ? 'fatal or serious-injury crashes' : e.spec.metric === 'fatal' ? 'fatal crashes' : 'reported crashes'}. These counts are not exposure-adjusted risk.</p><div class="text">${escapeHTML(d.body)}</div><h2>Data table</h2><div class="scroll"><table><thead><tr><th>Group</th><th>Crashes</th><th>Fatal / serious</th><th>Fatal crashes</th></tr></thead><tbody>${e.rows.map((r) => `<tr><td>${escapeHTML(r.label)}</td><td>${r.crashes}</td><td>${r.severe}</td><td>${r.fatal}</td></tr>`).join('')}</tbody></table></div><details><summary>Reproducible research specification</summary><pre>${escapeHTML(JSON.stringify({ spec: e.spec, sources: e.sources, generated: e.generated, sql: e.sql, parameters: e.parameters }, null, 2))}</pre></details><footer>Source: <a href="https://www.txdot.gov/data-maps/crash-reports-records/crash-data-analysis-statistics.html">Texas Department of Transportation public crash data</a>. Independent analysis; not affiliated with or endorsed by TxDOT. No individual crash participants are identified. This page does not establish legal fault.</footer></main></body></html>`;
}
export function exportCSV(d: Draft) {
  const cell = (x: unknown) => {
    const s = String(x ?? '');
    return (
      '"' + (/^[=+@\-\t\r]/.test(s) ? "'" : '') + s.replace(/"/g, '""') + '"'
    );
  };
  return [
    [
      'Group',
      'Crashes',
      'Fatal or serious-injury crashes',
      'Fatal crashes',
      'Deaths',
      'Serious injuries',
    ],
    ...d.evidence.rows.map((r) => [
      r.label,
      r.crashes,
      r.severe,
      r.fatal,
      r.deaths,
      r.serious,
    ]),
  ]
    .map((row) => row.map(cell).join(','))
    .join('\r\n');
}
