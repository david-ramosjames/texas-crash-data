import { COHORTS, number, titleCase, type Draft, type Domain } from "./contracts";
import { editorialRows, metricLabel, narrativeOnly } from "./editorial";
import { graphicLines } from "./infographic";
import { publicationTheme } from "./publication-profiles";
import { needsTimeRefresh } from "./research-quality";

export const SOCIAL_STYLES = {
  photo: "Photo-led news",
  statistic: "Big statistic",
  chart: "Mini infographic",
} as const;
export type SocialDesign = {
  style: keyof typeof SOCIAL_STYLES;
  headline: string;
  articleUrl: string;
  align: "center" | "left";
  carousel: boolean;
  referenceNotes: string;
};
export function socialDesign(raw?: string, strict = true): SocialDesign {
  const v = JSON.parse(raw || "{}");
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("Invalid social design.");
  const style = v.style ?? "photo",
    align = v.align ?? "center";
  if (!Object.hasOwn(SOCIAL_STYLES, style) || !["center", "left"].includes(align))
    throw new Error("Choose a supported social style.");
  const headline = v.headline ?? "",
    articleUrl = v.articleUrl ?? "",
    referenceNotes = v.referenceNotes ?? "";
  if (
    typeof headline !== "string" ||
    headline.length > 180 ||
    typeof referenceNotes !== "string" ||
    referenceNotes.length > 1000 ||
    typeof articleUrl !== "string" ||
    articleUrl.length > 2000
  )
    throw new Error(
      "Keep the image headline under 180 characters and reference notes under 1,000.",
    );
  if (articleUrl && strict) {
    let u: URL;
    try {
      u = new URL(articleUrl);
    } catch {
      throw new Error("Use a complete HTTPS article link, or leave it blank.");
    }
    if (u.protocol !== "https:" || u.username || u.password)
      throw new Error("Use an HTTPS article link without credentials.");
  }
  if (v.carousel !== undefined && typeof v.carousel !== "boolean")
    throw new Error("Invalid carousel choice.");
  return { style, headline, articleUrl, align, carousel: v.carousel ?? false, referenceNotes };
}
export function defaultSocialHeadline(d: Draft) {
  const r = editorialRows(d.evidence)[0];
  return r
    ? `${number(r[d.evidence.spec.metric])} ${metricLabel(d.evidence.spec.metric)}\n${titleCase(r.label)}`
    : d.title;
}
export function socialCaption(d: Draft) {
  const s = socialDesign(d.social_json, false),
    e = d.evidence;
  return `${narrativeOnly(d.body)
    .replace(/^##\s*/gm, "")
    .trim()}\n\nData: ${e.spec.start}–${e.spec.end}. Source: TxDOT public crash extract. Reported counts, not risk per trip or mile.${s.articleUrl ? "\n\nRead the full analysis: " + s.articleUrl : ""}`;
}
const esc = (v: string) =>
  v
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!,
    );

/** Self-contained image. Only locally supplied image bytes are accepted; no remote URLs/scripts. */
export function renderSocialCard(
  d: Draft,
  domain?: Domain,
  image?: string,
  slide = 0,
  review = false,
) {
  const e = d.evidence,
    s = socialDesign(d.social_json, false),
    t = publicationTheme(domain),
    rows = editorialRows(e),
    lead = rows[0];
  if (needsTimeRefresh(e))
    throw new Error("Run fresh hour-based research before creating a social image.");
  if (!lead) throw new Error("No returned groups are available for a social card.");
  if (!Number.isSafeInteger(lead[e.spec.metric]) || lead[e.spec.metric] < 0)
    throw new Error("Invalid saved crash counts.");
  if (![0, 1, 2].includes(slide) || (!s.carousel && slide !== 0))
    throw new Error("Invalid carousel slide.");
  const style = slide === 1 ? "chart" : s.style,
    context = slide === 2;
  const photo = style === "photo" && !context;
  if (photo && (!image || !/^data:image\/(png|jpeg);base64,[a-zA-Z0-9+/=]+$/.test(image)))
    throw new Error(
      "Select and save a cover illustration for the photo-led card, or choose a statistic/infographic style.",
    );
  const out: string[] = [];
  const lines = (
    value: string,
    x: number,
    y: number,
    width: number,
    size: number,
    max: number,
    color = "#fff",
    align: "center" | "left" = "left",
    bold = true,
  ) => {
    let wrapped = graphicLines(value, width, size * 1.08);
    while (wrapped.length > max && size > 18) {
      size -= 2;
      wrapped = graphicLines(value, width, size * 1.08);
    }
    if (wrapped.length > max)
      throw new Error("Shorten the image headline or group label to fit this social card.");
    wrapped.forEach((l, i) =>
      out.push(
        `<text x="${align === "center" ? x + width / 2 : x}" y="${y + i * size * 1.08}" text-anchor="${align === "center" ? "middle" : "start"}" fill="${color}" font-size="${size}" font-weight="${bold ? 900 : 400}">${esc(l)}</text>`,
      ),
    );
  };
  out.push(`<rect width="1080" height="1350" fill="${photo ? "#080808" : t.ink}"/>`);
  if (photo)
    out.push(
      `<image href="${image}" x="0" y="0" width="1080" height="1050" preserveAspectRatio="xMidYMid slice"/><rect width="1080" height="1350" fill="url(#shade)"/>`,
    );
  out.push(
    `<rect x="0" y="0" width="1080" height="12" fill="${t.color}"/><rect x="40" y="38" width="1000" height="70" rx="8" fill="#080808" fill-opacity=".86"/>`,
  );
  lines(domain?.name || "TEXAS CRASH RESEARCH", 64, 84, 952, 34, 1);
  if (review) lines("REVIEW COPY · NOT APPROVED", 64, 143, 952, 25, 1, "#fff", s.align, false);
  if (context) {
    lines("THE CONTEXT MATTERS", 64, 280, 952, 78, 2);
    lines(`${e.spec.start} — ${e.spec.end}`, 64, 460, 952, 38, 2);
    lines("REPORTED COUNTS ARE NOT THE RISK PER TRIP.", 64, 620, 952, 64, 3);
    lines(
      "Reporting may be incomplete. Road labels and vehicle groups require review. These records do not establish cause or fault.",
      64,
      860,
      952,
      32,
      5,
      "#fff",
      "left",
      false,
    );
    lines(
      s.articleUrl ? "READ THE FULL ANALYSIS · LINK IN CAPTION" : "SOURCE & LIMITS IN THE CAPTION",
      64,
      1120,
      952,
      33,
      2,
    );
  } else if (style === "chart") {
    lines("THE REPORTED PATTERN", 64, 240, 952, 68, 2);
    lines(COHORTS[e.spec.cohort].toUpperCase(), 64, 370, 952, 32, 2);
    lines(`Ranked by ${metricLabel(e.spec.metric)}`, 64, 465, 952, 29, 2, "#fff", "left", false);
    const shown = rows.slice(0, 3),
      max = Math.max(1, ...shown.map((r) => r[e.spec.metric]));
    shown.forEach((r, i) => {
      if (!Number.isSafeInteger(r[e.spec.metric]) || r[e.spec.metric] < 0)
        throw new Error("Invalid saved crash counts.");
      const y = 565 + i * 190;
      lines(`${i + 1}. ${titleCase(r.label)}`, 64, y, 952, 34, 2);
      lines(number(r[e.spec.metric]), 64, y + 90, 952, 42, 1);
      out.push(
        `<rect x="64" y="${y + 115}" width="952" height="18" rx="4" fill="#ffffff" fill-opacity=".18"/><rect x="64" y="${y + 115}" width="${(952 * r[e.spec.metric]) / max}" height="18" rx="4" fill="${t.color === t.ink ? "#fff" : t.color}"/>`,
      );
    });
    lines(
      "RETURNED GROUPS ONLY · DO NOT SUM GROUP COUNTS",
      64,
      1190,
      952,
      23,
      1,
      "#fff",
      "left",
      false,
    );
  } else if (style === "statistic") {
    lines(COHORTS[e.spec.cohort].toUpperCase(), 64, 265, 952, 36, 2);
    lines(number(lead[e.spec.metric]), 64, 560, 952, 180, 1);
    lines(metricLabel(e.spec.metric).toUpperCase(), 64, 720, 952, 60, 3);
    lines(titleCase(lead.label), 64, 1000, 952, 46, 3);
  } else {
    out.push(`<rect x="64" y="730" width="952" height="5" fill="${t.color}"/>`);
    lines(COHORTS[e.spec.cohort].toUpperCase(), 64, 778, 952, 27, 2);
    lines(
      (s.headline || defaultSocialHeadline(d)).toUpperCase(),
      64,
      900,
      952,
      76,
      4,
      "#fff",
      s.align,
    );
    lines(
      "AI ILLUSTRATION · NOT AN ACTUAL CRASH OR VERIFIED LOCATION",
      64,
      1210,
      952,
      20,
      1,
      "#fff",
      "left",
      false,
    );
  }
  out.push('<rect x="0" y="1235" width="1080" height="115" fill="#080808"/>');
  lines(
    `${e.spec.start} — ${e.spec.end} · SOURCE: TxDOT PUBLIC EXTRACT`,
    64,
    1280,
    952,
    25,
    1,
    "#fff",
    "left",
    false,
  );
  lines(
    "Reported counts, not risk per trip. See caption and full methods.",
    64,
    1320,
    952,
    24,
    1,
    "#fff",
    "left",
    false,
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350" role="img" aria-labelledby="title desc"><title id="title">${esc(s.headline || defaultSocialHeadline(d))}</title><desc id="desc">${esc(socialCaption(d))}</desc><defs><linearGradient id="shade" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".05"/><stop offset=".45" stop-color="#000" stop-opacity=".1"/><stop offset=".75" stop-color="#000" stop-opacity=".96"/><stop offset="1" stop-color="#000"/></linearGradient></defs><g font-family="Arial, sans-serif">${out.join("")}</g></svg>`;
}
