import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { database } from "../lib/db";
import { applyIndexMigration } from "../lib/index-migration";
const pool = database(),
  client = await pool.connect();
try {
  await client.query("SET statement_timeout='65min'");
  await client.query("SELECT pg_advisory_lock(7246230)");
  await client.query("SET statement_timeout='120s'");
  await client.query("CREATE SCHEMA IF NOT EXISTS studio");
  await client.query(
    "CREATE TABLE IF NOT EXISTS studio.schema_migrations (name text PRIMARY KEY, digest text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  await client.query("REVOKE ALL ON SCHEMA studio FROM PUBLIC");
  await client.query("ALTER TABLE studio.schema_migrations ENABLE ROW LEVEL SECURITY");
  const directory = new URL("../migrations/", import.meta.url);
  for (const name of (await readdir(directory))
    .filter((n) => n.endsWith(".sql") || n.endsWith(".index.json"))
    .sort()) {
    const sql = await readFile(new URL(name, directory), "utf8");
    const digest = createHash("sha256").update(sql).digest("hex");
    const old = await client.query("SELECT digest FROM studio.schema_migrations WHERE name=$1", [
      name,
    ]);
    if (old.rows.length) {
      if (old.rows[0].digest !== digest) throw new Error("Applied migration changed: " + name);
      continue;
    }
    if (name.endsWith(".index.json")) {
      console.log("Building concurrent index: " + name);
      // Migration-only limits. Research retains its existing 120-second limit.
      // The session advisory lock serializes web/worker pre-deploy migrations.
      await client.query("SET statement_timeout='30min'");
      await client.query("SET lock_timeout='15s'");
      try {
        await applyIndexMigration(client, sql);
        await client.query("INSERT INTO studio.schema_migrations(name,digest) VALUES($1,$2)", [
          name,
          digest,
        ]);
      } finally {
        await client.query("SET statement_timeout='120s'");
        await client.query("SET lock_timeout=0");
      }
      console.log("Applied " + name);
      continue;
    }
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO studio.schema_migrations(name,digest) VALUES($1,$2)", [
        name,
        digest,
      ]);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
    console.log("Applied " + name);
  }
  console.log("Database migrations complete.");
} finally {
  await client.query("SELECT pg_advisory_unlock(7246230)").catch(() => {});
  client.release();
  await pool.end();
}
