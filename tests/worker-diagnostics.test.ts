import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { withConnection, run } from '../lib/db';
import { research, validateSpec } from '../lib/research';
import { reportJobFailure } from '../lib/worker-diagnostics';
import { CrashTimeFormatError } from '../lib/csv';

test('invalid source times stop automatic retries and retain a safe record location', async () => {
  const logs: unknown[] = [];
  let saved = '', terminal: boolean | undefined;
  await reportJobFailure({ id: 'job', kind: 'repair_time', attempts: 1 }, 'Checking Crash_Time · test-batch · record 17',
    new CrashTimeFormatError(17), async (_job, message, stop) => { saved = message; terminal = stop; },
    (message, details) => { logs.push({ message, details }); });
  assert.equal(terminal, true);
  assert.match(saved, /CRASH_TIME_FORMAT/);
  assert.match(saved, /record 17 \(header excluded\)/);
  assert.match(JSON.stringify(logs), /CRASH_TIME_FORMAT/);
});

test('transient time repair network failures still retry', async () => {
  let terminal: boolean | undefined;
  await reportJobFailure({ id: 'job', kind: 'repair_time', attempts: 1 }, 'Reading archived crash CSV',
    { code: 'ECONNRESET' }, async (_job, _message, stop) => { terminal = stop; }, () => {});
  assert.equal(terminal, false);
});

const spec = validateSpec({ cohort: 'all', group: 'city', metric: 'crashes', start: '2024-12-01', end: '2024-12-31', min: 1, limit: 10 });

test('research awaits each query and progress write on its lock-owning connection', async () => {
  let active = 0, maximum = 0;
  const events: string[] = [];
  const connection = { query: async (sql: string, args?: unknown[]) => {
    active++; maximum = Math.max(maximum, active);
    try {
      assert.equal(active, 1, 'No overlapping calls to client.query');
      await delay(5);
      if (sql.startsWith('UPDATE jobs')) { events.push(String(args?.[0])); return { rows: [], rowCount: 1 }; }
      if (sql.startsWith('SELECT COUNT(*) total')) {
        events.push('totals'); return { rows: [{ total: 30, severe: 3, fatal: 1, unlocated: 0, no_intersection: 0 }] };
      }
      if (sql.startsWith('SELECT DISTINCT b.id')) {
        events.push('sources'); return { rows: [{ id: 'batch', start: spec.start, end: spec.end }] };
      }
      events.push('ranking'); return { rows: [{ label: 'DALLAS', crashes: 30, severe: 3, fatal: 1 }] };
    } finally { active--; }
  } };
  const result = await withConnection(connection, () => research(spec, async phase => {
    await run('UPDATE jobs SET progress=? WHERE id=?', phase, 'job');
  }));
  assert.equal(maximum, 1); assert.equal(result.total, 30); assert.equal(result.rows[0].share, 1);
  assert.deepEqual(events, ['Ranking groups', 'ranking', 'Counting matching crashes', 'totals', 'Checking source batches', 'sources']);
});

test('failed ranking does not leave queued queries running after rejection', async () => {
  const calls: string[] = [], phases: string[] = [];
  const error = Object.assign(new Error('private driver detail'), { code: '57014' });
  await assert.rejects(() => withConnection({ query: async (sql: string) => {
    calls.push(sql); await delay(5); throw error;
  } }, () => research(spec, async phase => { phases.push(phase); })), error);
  await delay(10);
  assert.equal(calls.length, 1);
  assert.deepEqual(phases, ['Ranking groups']);
});

test('worker logs safe original code before attempting to persist failure', async () => {
  const events: string[] = [], logs: unknown[] = [];
  const job = { id: 'test-job', kind: 'discover', attempts: 4 };
  let saved = '';
  await reportJobFailure(job, 'Question 2/42: all by intersection · Ranking groups',
    Object.assign(new Error('SELECT private-row; password=private-secret'), { code: '57014' }),
    async (actual, message) => { assert.equal(actual, job); events.push('persist'); saved = message; },
    (message, details) => { events.push('log'); logs.push({ message, details }); });
  assert.deepEqual(events, ['log', 'persist']);
  assert.match(saved, /Question 2\/42/); assert.match(saved, /\[code: 57014\]/);
  assert.match(JSON.stringify(logs), /57014/);
  assert.doesNotMatch(JSON.stringify({ saved, logs }), /private|SELECT|password/);
});

test('original failure remains in logs even if saving it fails on a read-only database', async () => {
  const codes: unknown[] = [];
  const persistenceError = Object.assign(new Error('private database details'), { code: '25006' });
  await assert.rejects(() => reportJobFailure({ id: 'job', kind: 'discover', attempts: 2 }, 'Counting matching crashes',
    { code: '53200' }, async () => { throw persistenceError; },
    (_message, details) => { codes.push(details.code); }), persistenceError);
  assert.deepEqual(codes, ['53200', '25006']);
});

test('uncoded validation text is private, never included in Railway failure logs', async () => {
  const logs: unknown[] = [];
  let saved = '';
  await reportJobFailure({ id: 'job', kind: 'import', attempts: 1 }, 'Validating crash',
    new Error('Invalid row customer-private-value'), async (_job, message) => { saved = message; },
    (message, details) => { logs.push({ message, details }); });
  assert.match(saved, /Invalid row/);
  assert.doesNotMatch(JSON.stringify(logs), /customer-private-value/);
});

test('worker passes progress to discovery, retains connection-bound writes and clears error on success', () => {
  const worker = readFileSync(new URL('../scripts/worker.ts', import.meta.url), 'utf8');
  assert.match(worker, /await discover\(progress, job.id\)/);
  assert.match(worker, /await reportJobFailure\(job, phase, error\)/);
  assert.match(worker, /status='complete',result=\?,error=NULL/);
  assert.match(worker, /withConnection\(client/);
  const ui = readFileSync(new URL('../components/studio.tsx', import.meta.url), 'utf8');
  assert.match(ui, /Last failure:/); assert.match(ui, /Attempt \{job.attempts\}\/5/);
  assert.match(ui, /<code>\{job.id\}<\/code>/);
});
