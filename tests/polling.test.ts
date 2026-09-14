import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { readFile } from 'node:fs/promises';
import { singleFlight, pollAfterCompletion } from '../lib/polling';

test('concurrent refresh requests share work and recover after a failure', async () => {
  let calls = 0;
  const refresh = singleFlight(async () => { calls++; await delay(10); if (calls === 1) throw new Error('temporary'); return calls; });
  const a = refresh(), b = refresh();
  assert.equal(a, b);
  await assert.rejects(a, /temporary/);
  assert.equal(await refresh(), 2);
});

test('slow polling never overlaps, skips hidden tabs, and stops after cleanup', async () => {
  let active = 0, maximum = 0, calls = 0, visible = false;
  let finish!: () => void;
  const started = new Promise<void>(resolve => { finish = resolve; });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const stop = pollAfterCompletion(async () => {
    calls++; active++; maximum = Math.max(maximum, active); finish();
    await gate; active--;
  }, 5, () => visible);
  await delay(20); assert.equal(calls, 0);
  visible = true; await started;
  await delay(25); assert.equal(calls, 1); assert.equal(maximum, 1);
  stop(); release(); await delay(20); assert.equal(calls, 1);
});

test('API and UI polling wiring uses lightweight activity and cached-only summaries', async () => {
  const route = await readFile(new URL('../app/api/[...path]/route.ts', import.meta.url), 'utf8');
  assert.match(route, /area === 'activity'\) return json\(await activity\(\)\)/);
  assert.equal((route.match(/summary\(undefined, \{ cachedOnly: true \}\)/g) || []).length, 2);
  const ui = await readFile(new URL('../components/studio.tsx', import.meta.url), 'utf8');
  assert.match(ui, /api\('activity'\)/); assert.doesNotMatch(ui, /setInterval/);
  assert.match(ui, /status.revision !== loadedRevision.current/);
});
