import assert from "node:assert/strict";
import { test } from "node:test";
import { applyIndexMigration, parseIndexMigration } from "../lib/index-migration";

const spec = { name: "crashes_city_upper_date", table: "crashes", keys: ["upper(city)", "date"] };
const source = JSON.stringify(spec);
const valid = {
  valid: true,
  unique_index: false,
  table_schema: "studio",
  table_name: "crashes",
  method: "btree",
  no_predicate: true,
  no_include: true,
  keys: spec.keys,
};
function mock(states: any[], failCreate = false) {
  const calls: string[] = [];
  return {
    calls,
    query: async (sql: string) => {
      calls.push(sql);
      if (sql.includes("FROM pg_class")) {
        const row = states.shift();
        return { rows: row ? [row] : [] };
      }
      if (failCreate && sql.startsWith("CREATE"))
        throw Object.assign(new Error("timeout"), { code: "57014" });
      return { rows: [] };
    },
  };
}
test("index manifests only allow narrow identifiers and upper expressions", () => {
  assert.deepEqual(parseIndexMigration(source), spec);
  for (const bad of [
    { ...spec, name: "x; DROP TABLE crashes" },
    { ...spec, keys: ["city DESC"] },
    { ...spec, table: "public.crashes" },
    { ...spec, extra: "sql" },
    { ...spec, keys: [] },
    null,
  ])
    assert.throws(() => parseIndexMigration(JSON.stringify(bad)));
});
test("concurrent builds verify validity without transactions and safely resume a completed build", async () => {
  const client = mock([null, valid]);
  await applyIndexMigration(client, source);
  assert.equal(client.calls.filter((s) => s.startsWith("CREATE INDEX CONCURRENTLY")).length, 1);
  assert(!client.calls.some((s) => /BEGIN|IF NOT EXISTS/.test(s)));
  const replay = mock([valid]);
  await applyIndexMigration(replay, source);
  assert.equal(replay.calls.length, 1);
});
test("only an invalid index with this exact definition is rebuilt", async () => {
  const client = mock([{ ...valid, valid: false }, valid]);
  await applyIndexMigration(client, source);
  assert.equal(client.calls[1], "DROP INDEX CONCURRENTLY studio.crashes_city_upper_date");
  for (const conflict of [
    { ...valid, keys: ["city"] },
    { ...valid, table_name: "other" },
    { ...valid, unique_index: true },
    { ...valid, no_predicate: false },
    { ...valid, no_include: false },
    {},
  ]) {
    const c = mock([conflict]);
    await assert.rejects(() => applyIndexMigration(c, source), /conflicts/);
    assert.equal(c.calls.length, 1);
  }
});
test("failed builds or invalid results propagate without pretending migration succeeded", async () => {
  await assert.rejects(() => applyIndexMigration(mock([null], true), source), { code: "57014" });
  await assert.rejects(
    () => applyIndexMigration(mock([null, { ...valid, valid: false }]), source),
    /did not become valid/,
  );
});
