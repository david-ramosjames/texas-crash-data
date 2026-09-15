import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { all, first, run, transaction } from "./db";
import { bucket } from "./storage";
import { BUILTIN_COVER, BUILTIN_COVER_ALT, COVER_CAPTION } from "./editorial";
import { COHORTS, type Cover, type Draft } from "./contracts";
const MAX_BYTES = 10_000_000;
export function coverPrompt(cohort: string) {
  const subject =
    cohort === "truck" || cohort === "cmv"
      ? "one unbranded semi-truck on a broad urban freeway, with no other vehicles"
      : cohort === "pedestrian"
        ? "an empty urban pedestrian crossing and sidewalk, no people or vehicles"
        : cohort === "cyclist"
          ? "an empty protected bicycle lane, no people or vehicles"
          : "an empty urban road with orderly lane markings, no people or vehicles";
  return `Create a refined wide photographic-style editorial AI illustration: ${subject}. Generic Texas-inspired built environment, plausible geometry, calm daylight, natural texture, restrained colors. No depiction of an actual crash or specific verified place. No damage, victims, emergency responders, dramatic danger, faces, license plates, logos, statistics, text, words or charts. Do not infer conditions or causes from crash data. This image will have a visible AI-illustration disclosure added outside the image.`;
}
export async function queueCover(draftId: string) {
  if (!process.env.OPENAI_API_KEY)
    throw new Error(
      "Configure OPENAI_API_KEY on the web and worker services, or choose the included cover.",
    );
  return transaction(async () => {
    const draft = await first<any>("SELECT evidence FROM drafts WHERE id=? FOR UPDATE", draftId);
    if (!draft) throw new Error("Draft not found.");
    const existing = await first<any>(
      "SELECT id,status FROM jobs WHERE kind='cover' AND payload::jsonb->>'draftId'=? AND status IN ('queued','running')",
      draftId,
    );
    if (existing) return existing;
    const id = crypto.randomUUID(),
      cohort = JSON.parse(draft.evidence).spec.cohort;
    await run(
      "INSERT INTO jobs(id,kind,payload,label) VALUES(?,'cover',?,'Generate editorial cover')",
      id,
      JSON.stringify({ draftId, cohort }),
    );
    return { id, status: "queued" };
  });
}
export async function generateCover(
  job: { id: string; payload: string; attempts?: number },
  progress: (s: string) => Promise<void>,
  request: typeof fetch = fetch,
  storage = bucket(),
) {
  const existing = await first<any>("SELECT id FROM editorial_covers WHERE job_id=?", job.id);
  if (existing)
    return { coverId: existing.id, note: "Cover ready to select in the editorial desk." };
  const payload = JSON.parse(job.payload);
  if (
    !Object.hasOwn(COHORTS, payload.cohort) ||
    !(await first("SELECT id FROM drafts WHERE id=?", payload.draftId))
  )
    throw new Error("Cover request is invalid.");
  if (!process.env.OPENAI_API_KEY)
    throw new Error("Configure OPENAI_API_KEY on the worker before generating a cover.");
  const prompt = coverPrompt(payload.cohort),
    model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";
  const key = `editorial-covers/${job.id}.jpg`;
  // Reuse an image saved before interruption. A timeout before storage is
  // ambiguous: require a manual retry rather than silently billing five times.
  await progress("Preparing cover illustration");
  const stored = await storage.head(key);
  let size = 0;
  if (stored) {
    const old = await storage.get(key);
    size = (await new Response(old.body).arrayBuffer()).byteLength;
  } else {
    if ((job.attempts || 1) > 1)
      throw new Error(
        "Cover generation was interrupted before its image was saved. Retry explicitly in Data library; another API request may incur a charge.",
      );
    await progress("Generating cover illustration · this may take a few minutes");
    const response = await request("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        prompt,
        n: 1,
        size: "1536x1024",
        quality: "medium",
        output_format: "jpeg",
      }),
      signal: AbortSignal.timeout(180000),
    });
    if (!response.ok)
      throw new Error(
        `Cover generation failed (HTTP ${response.status}). Check image-model access and API quota. Retry explicitly; your draft was not changed.`,
      );
    const result = await response.json(),
      base64 = result.data?.[0]?.b64_json;
    if (typeof base64 !== "string" || base64.length > 14_000_000)
      throw new Error("The image service did not return a supported cover.");
    const bytes = Buffer.from(base64, "base64");
    size = bytes.byteLength;
    if (size < 4 || size > MAX_BYTES || bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255)
      throw new Error("The image service returned invalid JPEG data.");
    await progress("Saving cover privately");
    await storage.put(
      key,
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    );
  }
  const alt =
    "AI illustration of " +
    (payload.cohort === "truck" || payload.cohort === "cmv"
      ? "an unbranded semi-truck on a generic urban freeway."
      : "a generic urban streetscape.");
  await run(
    "INSERT INTO editorial_covers(id,draft_id,job_id,storage_key,mime,bytes,alt,prompt,model) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(job_id) DO NOTHING",
    job.id,
    payload.draftId,
    job.id,
    key,
    "image/jpeg",
    size,
    alt,
    prompt,
    model,
  );
  return {
    coverId: job.id,
    note: "Cover ready to select in the editorial desk. Nothing was attached or approved automatically.",
  };
}
export async function coverChoices(draftId: string): Promise<Cover[]> {
  const generated = await all<{ id: string; alt: string }>(
    "SELECT id,alt FROM editorial_covers WHERE draft_id=? ORDER BY created DESC",
    draftId,
  );
  return [
    {
      id: BUILTIN_COVER,
      alt: BUILTIN_COVER_ALT,
      caption: COVER_CAPTION,
      url: `/editorial/${BUILTIN_COVER}.png`,
    },
    ...generated.map((c) => ({ ...c, caption: COVER_CAPTION, url: `/api/covers/${c.id}` })),
  ];
}
export async function validateCover(id: unknown, draftId: string) {
  if (id == null || id === "") return null;
  if (id === BUILTIN_COVER) return id;
  if (
    typeof id !== "string" ||
    !(await first("SELECT id FROM editorial_covers WHERE id=? AND draft_id=?", id, draftId))
  )
    throw new Error("Choose a cover generated for this draft or the included illustration.");
  return id;
}
export async function coverBytes(id: string) {
  if (id === BUILTIN_COVER)
    return {
      bytes: new Uint8Array(
        await readFile(join(process.cwd(), "public", "editorial", `${BUILTIN_COVER}.png`)),
      ),
      mime: "image/png",
      ext: "png",
      alt: BUILTIN_COVER_ALT,
    };
  const cover = await first<any>("SELECT * FROM editorial_covers WHERE id=?", id);
  if (!cover) throw new Error("Cover not found.");
  const file = await bucket().get(cover.storage_key),
    bytes = new Uint8Array(await new Response(file.body).arrayBuffer());
  if (bytes.length !== cover.bytes || bytes.length > MAX_BYTES)
    throw new Error("Stored cover failed validation.");
  return { bytes, mime: cover.mime as string, ext: "jpg", alt: cover.alt as string };
}
export async function hydrateCover(draft: Draft) {
  if (!draft.cover_id) return draft;
  const choice =
    draft.cover_id === BUILTIN_COVER
      ? {
          id: BUILTIN_COVER,
          alt: BUILTIN_COVER_ALT,
          caption: COVER_CAPTION,
          url: `/editorial/${BUILTIN_COVER}.png`,
        }
      : await first<{ id: string; alt: string }>(
          "SELECT id,alt FROM editorial_covers WHERE id=? AND draft_id=?",
          draft.cover_id,
          draft.id,
        );
  if (!choice)
    throw new Error("Saved cover is unavailable. Choose another cover before exporting.");
  return {
    ...draft,
    cover: {
      ...choice,
      caption: COVER_CAPTION,
      url:
        draft.cover_id === BUILTIN_COVER
          ? `/editorial/${BUILTIN_COVER}.png`
          : `/api/covers/${choice.id}`,
    },
  };
}
