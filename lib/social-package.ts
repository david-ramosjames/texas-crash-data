import type { Draft, Domain } from "./contracts";
import { coverBytes } from "./covers";
import { renderSocialCard, socialCaption, socialDesign } from "./social";
import { editorialMethods } from "./editorial";
import { exportCSV } from "./export";
import type { ZipEntry } from "./zip";
export async function socialImage(d: Draft, domain?: Domain, slide = 0) {
  const design = socialDesign(d.social_json);
  const cover =
    design.style === "photo" && slide === 0 && d.cover_id ? await coverBytes(d.cover_id) : null;
  return renderSocialCard(
    d,
    domain,
    cover ? `data:${cover.mime};base64,${Buffer.from(cover.bytes).toString("base64")}` : undefined,
    slide,
  );
}
export async function socialEntries(d: Draft, domain?: Domain): Promise<ZipEntry[]> {
  const entries: ZipEntry[] = [
    { name: "caption.txt", text: socialCaption(d) },
    { name: "methodology.txt", text: editorialMethods(d.evidence).join("\n\n") },
    { name: "evidence.json", text: JSON.stringify(d.evidence, null, 2) },
    { name: "data.csv", text: exportCSV(d) },
    {
      name: "README.txt",
      text: "Approved social post package. Copy caption.txt and attach the image when posting. SVG files contain their own imagery; download PNG from the Social editor for platforms that do not accept SVG. Verify any article link is live before posting. Reference images are not included, and reference notes never become content instructions. Generated cover imagery is illustrative, not a real crash or verified location. No post has been sent, scheduled or published. The separate methodology and evidence files are for review, not part of the caption.",
    },
  ];
  for (let i = 0; i < (socialDesign(d.social_json).carousel ? 3 : 1); i++)
    entries.push({ name: `social-${i + 1}.svg`, text: await socialImage(d, domain, i) });
  return entries;
}
