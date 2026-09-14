import { createHash } from "node:crypto";
import { first, run, transaction } from "./db";

// Bump when research/finding semantics change. Never reuse older algorithm results.
const VERSION = "discovery-v2-hour-quality";
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
export async function discoveryCheckpoints(jobId?: string) {
  const generation =
    (await first<{ value: string }>("SELECT value FROM settings WHERE key='summary_generation'"))
      ?.value || "0";
  const key = (kind: string, input: unknown) =>
    createHash("sha256")
      .update(JSON.stringify([kind, canonical(input)]))
      .digest("hex");
  const assertCurrent = async () => {
    const current =
      (await first<{ value: string }>("SELECT value FROM settings WHERE key='summary_generation'"))
        ?.value || "0";
    if (current !== generation)
      throw new Error(
        "Imported data changed during discovery. Retry to scan the current data; old checkpoints will not be reused.",
      );
  };
  async function read<T>(kind: string, input: unknown): Promise<T | null> {
    if (!jobId) return null;
    const row = await first<{ value: string }>(
      "SELECT value FROM discovery_checkpoints WHERE job_id=? AND generation=? AND version=? AND step_key=?",
      jobId,
      generation,
      VERSION,
      key(kind, input),
    );
    return row ? (JSON.parse(row.value) as T) : null;
  }
  async function save<T>(kind: string, input: unknown, value: T) {
    if (!jobId) return;
    await assertCurrent();
    await run(
      "INSERT INTO discovery_checkpoints(job_id,generation,version,step_key,value) VALUES(?,?,?,?,?) ON CONFLICT DO NOTHING",
      jobId,
      generation,
      VERSION,
      key(kind, input),
      JSON.stringify(value),
    );
  }
  return {
    read,
    assertCurrent,
    // Analysis is read-only. A failed query never creates a completed checkpoint.
    async query<T>(
      kind: string,
      input: unknown,
      label: string,
      progress: (stage: string) => Promise<void>,
      task: () => Promise<T>,
    ): Promise<T> {
      const old = await read<T>(kind, input);
      if (old !== null) {
        await progress(`${label} · Reusing verified result`);
        return old;
      }
      const result = await task();
      await save(kind, input, result);
      return result;
    },
    // Finding writes and their completion marker commit together. Replaying a
    // successful question never overwrites an editor's decision or double-counts it.
    async commit<T>(kind: string, input: unknown, task: () => Promise<T>): Promise<T> {
      const old = await read<T>(kind, input);
      if (old !== null) return old;
      return transaction(async () => {
        await assertCurrent();
        const value = await task();
        await save(kind, input, value);
        return value;
      });
    },
  };
}
