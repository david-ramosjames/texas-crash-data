import type { Draft } from './contracts';
export const escapeHTML = (s: unknown) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );
export { renderPublication as renderPage, renderChart } from './publication';
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
