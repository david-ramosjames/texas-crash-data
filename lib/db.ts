import pg from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';
export { bucket } from './storage';
export const runtime = () => process.env;
pg.types.setTypeParser(20, (value) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error('Database count exceeds safe integer range.');
  return n;
});
type Connection = { query: (sql: string, args?: any[]) => Promise<any> };
const context = new AsyncLocalStorage<Connection>();
const inTransaction = new AsyncLocalStorage<boolean>();
let pool: pg.Pool | undefined;
export function database() {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured.');
    const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(process.env.DATABASE_URL).hostname);
    const url = new URL(process.env.DATABASE_URL);
    // Never let connection-string sslmode override certificate verification.
    for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) url.searchParams.delete(key);
    pool = new pg.Pool({ connectionString: url.toString(), max: Number(process.env.DB_POOL_MAX || 5),
      ssl: local ? false : { rejectUnauthorized: true, ...(process.env.DATABASE_CA_CERT ? { ca: process.env.DATABASE_CA_CERT.replace(/\\n/g, '\n') } : {}) },
      options: '-c search_path=studio,extensions,public',
      statement_timeout: 120000, connectionTimeoutMillis: 15000, idleTimeoutMillis: 30000,
    });
    pool.on('error', () => console.error('Idle database connection failed; the next request will reconnect.'));
  }
  return pool;
}
// Parameter conversion only, not SQL translation. Preserve quoted literals.
export function parameters(sql: string) {
  let index = 0;
  return sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|\?/g, (token) => token === '?' ? `$${++index}` : token);
}
export async function execute(sql: string, args: unknown[] = []) {
  return (context.getStore() || database()).query(parameters(sql), args);
}
export async function all<T = Record<string, unknown>>(sql: string, ...args: unknown[]): Promise<T[]> {
  return (await execute(sql, args)).rows;
}
export async function first<T = Record<string, unknown>>(sql: string, ...args: unknown[]): Promise<T | null> {
  return (await all<T>(sql, ...args))[0] || null;
}
export async function run(sql: string, ...args: unknown[]) {
  const result = await execute(sql, args);
  return { meta: { changes: result.rowCount ?? result.affectedRows ?? 0 } };
}
export async function transaction<T>(fn: () => Promise<T>): Promise<T> {
  if (inTransaction.getStore()) return fn();
  const bound = context.getStore();
  if (bound) {
    await bound.query('BEGIN');
    try { const result = await inTransaction.run(true, fn); await bound.query('COMMIT'); return result; }
    catch (error) { await bound.query('ROLLBACK'); throw error; }
  }
  const client = await database().connect();
  try {
    await client.query('BEGIN');
    const result = await context.run(client, () => inTransaction.run(true, fn));
    await client.query('COMMIT');
    return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
export class Statement {
  constructor(public sql: string, public args: unknown[] = []) {}
  bind(...args: unknown[]) { return new Statement(this.sql, args); }
  run() { return run(this.sql, ...this.args); }
}
export const db = () => ({
  prepare: (sql: string) => new Statement(sql),
  batch: (statements: Statement[]) => transaction(async () => {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }),
});
// Test connection injection; never an HTTP authentication bypass.
export const withConnection = <T>(connection: Connection, fn: () => Promise<T>) => context.run(connection, fn);
