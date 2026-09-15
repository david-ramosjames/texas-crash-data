import { COHORTS, GROUPS, number, titleCase, type Draft, type Domain } from "./contracts";
import { editorialMethods, editorialRows, metricLabel } from "./editorial";
import { publicationTheme } from "./publication-profiles";
import { needsTimeRefresh } from "./research-quality";

const xml = (value: string) =>
  value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!,
    );
// Conservative line measurement; long tokens are broken rather than overflowing the canvas.
export function graphicLines(text: string, width: number, size: number) {
  const lines: string[] = [];
  let line = "",
    used = 0;
  for (const word of text.replace(/\s+/g, " ").trim().split(" ")) {
    const measure = (s: string) =>
      [...s].reduce(
        (n, c) =>
          n +
          (/\s/.test(c) ? 0.34 : /[MW@%]/.test(c) ? 0.95 : c.charCodeAt(0) > 255 ? 1 : 0.64) * size,
        0,
      );
    if (line && used + measure(" " + word) <= width) {
      line += " " + word;
      used = measure(line);
      continue;
    }
    if (line) {
      lines.push(line);
      line = "";
      used = 0;
    }
    for (const c of word) {
      const w = measure(c);
      if (used + w > width && line) {
        lines.push(line);
        line = "";
        used = 0;
      }
      line += c;
      used += w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function infographicNotes(draft: Draft) {
  return `${draft.title}\n\nInfographic: current-period totals and first five returned groups. Groups are not necessarily the full cohort and must not be summed as a unique crash total.\n\n${editorialMethods(draft.evidence).join("\n\n")}\n\nQuery filters: ${JSON.stringify(draft.evidence.spec)}\nSource batch IDs: ${draft.evidence.sources.map((s) => s.id).join(", ")}`;
}

export function renderInfographic(draft: Draft, domain?: Domain, preview = false) {
  const e = draft.evidence;
  if (needsTimeRefresh(e))
    throw new Error(
      "Run fresh hour-based research after the AM/PM correction before creating an infographic.",
    );
  const rows = editorialRows(e).slice(0, 5),
    theme = publicationTheme(domain);
  if (
    ![e.total, e.severe, e.fatal, ...rows.flatMap((r) => [r.crashes, r.severe, r.fatal])].every(
      (n) => Number.isSafeInteger(n) && n >= 0,
    )
  )
    throw new Error("The saved evidence contains invalid counts. Run fresh research.");
  const parts: string[] = [];
  let y = 64;
  const text = (
    value: string,
    size = 28,
    color = theme.ink,
    weight = 400,
    x = 64,
    width = 1072,
  ) => {
    const lines = graphicLines(value, width, size);
    for (const line of lines) {
      parts.push(
        `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${color}">${xml(line)}</text>`,
      );
      y += size * 1.35;
    }
  };
  parts.push(`<rect width="1200" height="12" fill="${theme.color}"/>`);
  text(domain?.name || "TEXAS CRASH RESEARCH", 26, theme.ink, 700);
  if (preview) text("REVIEW COPY · NOT FOR PUBLICATION", 22, "#8b3b13", 700);
  y += 22;
  text(draft.title.slice(0, 600) + (draft.title.length > 600 ? "…" : ""), 48, theme.ink, 700);
  y += 15;
  text(`DATA PERIOD  ${e.spec.start} — ${e.spec.end}`, 27, theme.ink, 700);
  text(
    `${COHORTS[e.spec.cohort]} · ${e.spec.city ? titleCase(e.spec.city) : e.spec.county ? titleCase(e.spec.county) + " County" : "Texas"}`,
    27,
  );
  const filters = Object.entries(e.spec).filter(
    ([k, v]) =>
      !["cohort", "group", "metric", "start", "end", "min", "limit", "compare"].includes(k) &&
      v !== undefined &&
      v !== "",
  );
  if (filters.length) text("Filters: " + filters.map(([k, v]) => `${k}: ${v}`).join(" · "), 22);
  y += 22;
  text("FULL FILTERED COHORT · NOT JUST THE GROUPS BELOW", 23, theme.ink, 700);
  const cardsTop = y;
  const stats = [
    [e.total, "Reported crashes"],
    [e.severe, "Fatal or suspected serious-injury crashes"],
    [e.fatal, "Fatal crashes"],
  ] as const;
  stats.forEach(([value, label], i) => {
    const x = 64 + i * 365;
    parts.push(
      `<rect x="${x}" y="${cardsTop}" width="342" height="222" rx="12" fill="${theme.soft}"/><rect x="${x}" y="${cardsTop}" width="342" height="5" fill="${theme.color}"/>`,
    );
    y = cardsTop + 65;
    text(
      number(value),
      Math.min(46, 298 / (number(value).length * 0.64)),
      theme.ink,
      700,
      x + 22,
      298,
    );
    y = cardsTop + 114;
    text(label, 25, theme.ink, 400, x + 22, 298);
  });
  y = cardsTop + 274;
  text(`${GROUPS[e.spec.group]} ranking`, 34, theme.ink, 700);
  text(
    `${rows.length} of ${editorialRows(e).length} returned groups · Ranked by ${metricLabel(e.spec.metric)}`,
    25,
  );
  if (e.comparison?.focusLabel)
    text("Selected comparison group only; totals above describe the full query.", 23);
  const max = Math.max(1, ...rows.map((r) => r[e.spec.metric]));
  y += 15;
  rows.forEach((r, i) => {
    text(
      `${i + 1}. ${titleCase(r.label).slice(0, 240)}${r.label.length > 240 ? "…" : ""}`,
      28,
      theme.ink,
      700,
    );
    text(`${number(r[e.spec.metric])} ${metricLabel(e.spec.metric)}`, 26);
    parts.push(
      `<rect x="64" y="${y}" width="1072" height="20" rx="5" fill="${theme.soft}"/><rect x="64" y="${y}" width="${(1072 * r[e.spec.metric]) / max}" height="20" rx="5" fill="${theme.color}"/>`,
    );
    y += 58;
  });
  if (!rows.length) text("No returned groups met the saved query criteria.", 28);
  y += 12;
  parts.push(`<line x1="64" x2="1136" y1="${y}" y2="${y}" stroke="#cad4de"/>`);
  y += 50;
  text("WHAT THESE NUMBERS MEAN", 25, theme.ink, 700);
  const notes = [
    "Reported crash counts, not risk per trip or mile. Traffic exposure is not controlled. These data do not establish cause or legal fault.",
    `Minimum group size: ${e.spec.min}. Only returned groups are shown; groups may overlap and must not be summed as a unique crash total.`,
    ...(e.spec.cohort === "truck"
      ? ["Truck = body styles 87 (truck tractor) and 106 (truck). Pickups and SUVs excluded."]
      : []),
    ...(e.spec.group === "road"
      ? [
          "Reported road names are not verified corridors. Spelling and directional variants remain separate.",
        ]
      : []),
    ...(e.spec.group === "intersection"
      ? [
          `${number(e.excluded)} matching crashes lacked usable intersection pairs and are excluded from this grouping.`,
        ]
      : []),
    ...(e.comparison
      ? ["Current period only. Comparison results are not displayed in this graphic."]
      : []),
    "Supplied date intervals do not guarantee complete reporting. Later reports and amendments can change counts. Read the accompanying article and methodology before sharing.",
  ];
  for (const note of notes) {
    text(note, 24);
    y += 12;
  }
  if (e.warnings.length)
    text(
      `${e.warnings.length} additional coverage/quality note(s) accompany the saved evidence. Review the full methodology.`,
      24,
    );
  y += 18;
  text("Source: Texas Department of Transportation public crash extract.", 23, theme.ink, 700);
  text(`Evidence snapshot: ${e.generated.slice(0, 10)} · ${e.sources.length} source batches`, 23);
  if (domain?.host) text(`Publication: ${domain.host} · ${domain.byline}`, 23);
  y += 40;
  if (y > 8000)
    throw new Error(
      "This infographic is too tall. Shorten the headline or simplify the research filters.",
    );
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${Math.ceil(y)}" viewBox="0 0 1200 ${Math.ceil(y)}" role="img" aria-labelledby="infographic-title infographic-desc"><title id="infographic-title">${xml(draft.title)}</title><desc id="infographic-desc">${xml(infographicNotes(draft))} ${xml(rows.map((r) => `${r.label}: ${r[e.spec.metric]} ${metricLabel(e.spec.metric)}`).join("; "))}</desc><rect width="1200" height="100%" fill="#ffffff"/><g font-family="Arial,sans-serif">${parts.join("")}</g></svg>`;
}
