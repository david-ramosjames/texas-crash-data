import { all, first, run, transaction } from "./db";
import { originalStream } from "./process-import";
import { readCSV, parseCrashHour } from "./csv";
import { cachedSummary } from "./summary-cache";

export async function enqueueTimeRepair() {
  if (
    !(await first(
      "SELECT id FROM batches WHERE status='complete' AND time_parser_version<2 LIMIT 1",
    ))
  )
    return;
  // A terminal failure needs the explicit Retry job action, not endless fresh jobs.
  if (
    await first(
      "SELECT id FROM jobs WHERE kind='repair_time' AND status IN ('queued','running','failed') LIMIT 1",
    )
  )
    return;
  await run(
    "INSERT INTO jobs(id,kind,label) VALUES(?,'repair_time','Correct AM/PM hours from archived originals') ON CONFLICT DO NOTHING",
    crypto.randomUUID(),
  );
}
export async function repairTimes(
  progress: (message: string) => Promise<void>,
  stagingBatch?: string,
) {
  const batches = await all<any>(
    "SELECT b.id,f.rows expected FROM batches b JOIN files f ON f.batch_id=b.id AND f.kind='crash' WHERE " +
      (stagingBatch ? "b.status='processing' AND b.id=?" : "b.status='complete'") +
      " AND b.time_parser_version<2 ORDER BY b.id",
    ...(stagingBatch ? [stagingBatch] : []),
  );
  let changed = 0;
  for (const [index, b] of batches.entries()) {
    await run("INSERT INTO time_repairs(batch_id) VALUES(?) ON CONFLICT DO NOTHING", b.id);
    const saved = await first<any>("SELECT * FROM time_repairs WHERE batch_id=?", b.id);
    let seen = 0,
      pending: { id: string; hour: number | null }[] = [];
    const flush = async () => {
      if (!pending.length) return;
      const values = pending;
      pending = [];
      await transaction(async () => {
        // PK lookups in bounded chunks. Do not rewrite unchanged rows or scan
        // the crash table for each original row. Progress commits with updates.
        const found = await first<any>(
          `SELECT COUNT(*) n FROM crashes WHERE batch_id=? AND id=ANY(?::text[])`,
          b.id,
          values.map((x) => x.id),
        );
        if (Number(found?.n) !== values.length)
          throw new Error("Time repair row IDs do not match the indexed batch.");
        const result = await run(
          `UPDATE crashes c SET hour=v.hour FROM jsonb_to_recordset(?::jsonb) AS v(id text,hour integer) WHERE c.batch_id=? AND c.id=v.id AND c.hour IS DISTINCT FROM v.hour`,
          JSON.stringify(values),
          b.id,
        );
        changed += result.meta.changes;
        await run(
          "UPDATE time_repairs SET rows_done=?,changed=changed+? WHERE batch_id=?",
          seen,
          result.meta.changes,
          b.id,
        );
      });
      await progress(
        `Correcting AM/PM · batch ${index + 1}/${batches.length} · ${seen.toLocaleString()} rows checked`,
      );
    };
    await progress(`Reading archived crash CSV · batch ${index + 1}/${batches.length}`);
    const stream = await originalStream(b.id, "crash");
    for await (const row of readCSV({ stream: () => stream })) {
      seen++;
      if (seen <= saved.rows_done) continue;
      pending.push({ id: row.Crash_ID?.trim(), hour: parseCrashHour(row.Crash_Time || "") });
      if (pending.length === 500) await flush();
    }
    await flush();
    if (seen !== Number(b.expected) || seen < saved.rows_done)
      throw new Error("Archived crash row count does not match the verified import.");
    await transaction(async () => {
      await run("UPDATE time_repairs SET complete=true WHERE batch_id=?", b.id);
      await run("UPDATE batches SET time_parser_version=2 WHERE id=?", b.id);
    });
  }
  if (stagingBatch)
    return {
      batches: batches.length,
      changed,
      note: "Staged hours corrected before revision comparison.",
    };
  // Hours do not change summary counts. Keep the exact cache, but invalidate
  // analysis checkpoints so no result using old hour values is reused.
  await transaction(async () => {
    const cache = await cachedSummary(),
      generation = crypto.randomUUID();
    await run(
      "INSERT INTO settings(key,value) VALUES('summary_generation',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      generation,
    );
    if (cache.value) {
      await run(
        "UPDATE settings SET value=? WHERE key='summary_cache'",
        JSON.stringify({ generation, value: cache.value }),
      );
      await run("UPDATE settings SET value=? WHERE key='summary_cached_generation'", generation);
    }
    await run(
      "INSERT INTO settings(key,value) VALUES('discovery_stale','true') ON CONFLICT(key) DO UPDATE SET value='true'",
    );
  });
  return {
    batches: batches.length,
    changed,
    note: "AM/PM corrected. Old hour-based evidence requires a new scan.",
  };
}
