// Deliberately narrow manifests: ordinary btree indexes in the private schema.
// No arbitrary SQL splitting, IF NOT EXISTS, or removal of unrelated indexes.
type Client = { query: (sql: string, args?: any[]) => Promise<any> };
type IndexSpec = { name: string; table: string; keys: string[] };
export function parseIndexMigration(source: string): IndexSpec {
  const s = JSON.parse(source);
  const identifier = /^[a-z][a-z0-9_]{0,62}$/;
  if (
    !s ||
    Object.keys(s).sort().join(",") !== "keys,name,table" ||
    typeof s.name !== "string" ||
    !identifier.test(s.name) ||
    typeof s.table !== "string" ||
    !identifier.test(s.table) ||
    !Array.isArray(s.keys) ||
    !s.keys.length ||
    s.keys.length > 8 ||
    !s.keys.every(
      (k: unknown) =>
        typeof k === "string" &&
        (/^[a-z][a-z0-9_]{0,62}$/.test(k) || /^upper\([a-z][a-z0-9_]{0,62}\)$/.test(k)),
    )
  )
    throw new Error("Invalid concurrent index migration manifest");
  return s;
}
export async function applyIndexMigration(client: Client, source: string) {
  const s = parseIndexMigration(source);
  const inspect = async () =>
    (
      await client.query(
        `
    SELECT i.indisvalid valid, i.indisunique unique_index,
      tn.nspname table_schema, t.relname table_name, am.amname method,
      i.indpred IS NULL no_predicate, i.indnatts=i.indnkeyatts no_include,
      ARRAY(SELECT pg_get_indexdef(i.indexrelid,k,true)
        FROM generate_series(1,i.indnkeyatts) k ORDER BY k) keys
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_index i ON i.indexrelid=c.oid
    LEFT JOIN pg_class t ON t.oid=i.indrelid
    LEFT JOIN pg_namespace tn ON tn.oid=t.relnamespace
    LEFT JOIN pg_am am ON am.oid=c.relam
    WHERE n.nspname='studio' AND c.relname=$1`,
        [s.name],
      )
    ).rows[0];
  const matches = (r: any) =>
    r.table_schema === "studio" &&
    r.table_name === s.table &&
    r.method === "btree" &&
    r.unique_index === false &&
    r.no_predicate &&
    r.no_include &&
    JSON.stringify(r.keys) === JSON.stringify(s.keys);
  const old = await inspect();
  if (old) {
    if (!matches(old)) throw new Error("Existing index definition conflicts: " + s.name);
    if (old.valid) return; // Build finished but process stopped before ledger write.
    // A cancelled concurrent build can leave an invalid index. Only this exact
    // migration-owned definition is eligible for recovery; never drop a valid one.
    await client.query(`DROP INDEX CONCURRENTLY studio.${s.name}`);
  }
  await client.query(
    `CREATE INDEX CONCURRENTLY ${s.name} ON studio.${s.table} (${s.keys.join(", ")})`,
  );
  const built = await inspect();
  if (!built || !matches(built) || !built.valid)
    throw new Error("Concurrent index did not become valid: " + s.name);
}
