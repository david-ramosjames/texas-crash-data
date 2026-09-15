import { first, run, transaction, bucket } from "./db";
export function referenceMime(bytes: Uint8Array) {
  if (bytes.length < 24 || bytes.length > 8_000_000)
    throw new Error("Use a PNG or JPEG reference under 8 MB.");
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      width = view.getUint32(16),
      height = view.getUint32(20);
    if (!width || !height || width * height > 25_000_000)
      throw new Error("Reference image dimensions are too large.");
    return "image/png";
  }
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  throw new Error("Reference must contain PNG or JPEG image data.");
}
export async function storeReference(draftId: string, req: Request, storage = bucket()) {
  if (!(await first("SELECT id FROM drafts WHERE id=? AND channel='social'", draftId)))
    throw new Error("Choose a social draft.");
  const reader = req.body?.getReader();
  if (!reader) throw new Error("Image required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.length;
    if (size > 8_000_000) {
      await reader.cancel();
      throw new Error("Use a reference under 8 MB.");
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const mime = referenceMime(bytes),
    id = crypto.randomUUID(),
    key = `social-references/${draftId}/${id}`;
  await storage.put(key, bytes.buffer);
  await transaction(async () => {
    await run(
      "INSERT INTO social_references(id,draft_id,storage_key,mime,bytes) VALUES(?,?,?,?,?)",
      id,
      draftId,
      key,
      mime,
      size,
    );
    await run("UPDATE drafts SET social_reference_id=? WHERE id=?", id, draftId);
  });
  return { id };
}
export async function referenceImage(draftId: string, storage = bucket()) {
  const row = await first<any>(
    "SELECT r.* FROM drafts d JOIN social_references r ON r.id=d.social_reference_id AND r.draft_id=d.id WHERE d.id=?",
    draftId,
  );
  if (!row) throw new Error("No reference is saved for this draft.");
  return { mime: row.mime, body: (await storage.get(row.storage_key)).body };
}
