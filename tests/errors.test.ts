import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { requestFailure } from '../lib/errors';

test('database codes provide useful hints without leaking driver details', () => {
  for (const code of ['42P01', '42703', '28P01', '23505', '42501', 'XX000']) {
    const result = requestFailure(Object.assign(new Error('password=private-value SELECT secret FROM customer'), {
      code, detail: 'private-row', query: 'private-query', connectionString: 'postgres://private',
    }));
    assert.equal(result.code, code);
    assert.ok(result.error.includes(`[code: ${code}]`));
    assert.doesNotMatch(JSON.stringify(result), /private|SELECT|customer/);
  }
  assert.match(requestFailure({ code: '42P01' }).error, /migrations/);
});

test('wrapped TLS and network codes are surfaced safely', () => {
  for (const code of ['SELF_SIGNED_CERT_IN_CHAIN', 'ENOTFOUND', 'ECONNREFUSED']) {
    const result = requestFailure(new Error('fetch failed', { cause: { code, message: 'private-host' } }));
    assert.equal(result.code, code);
    assert.doesNotMatch(result.error, /private-host/);
  }
  assert.match(requestFailure({ code: 'SELF_SIGNED_CERT_IN_CHAIN' }).error, /keep certificate verification enabled/);
});

test('unknown codes and secret-looking messages are not echoed; validation is preserved', () => {
  assert.equal(requestFailure({ code: 'postgres://private-password@host' }).code, 'CONNECTION_OR_SERVICE_ERROR');
  assert.doesNotMatch(requestFailure(new Error('connection postgres://private-password@host')).error, /private-password/);
  assert.equal(requestFailure(new Error('Invalid file type.')).error, 'Invalid file type.');
  const cyclic: { cause?: unknown } = {}; cyclic.cause = cyclic;
  assert.equal(requestFailure(cyclic).code, 'REQUEST_ERROR');
});

test('API catch returns safe diagnostics and logs only their code', () => {
  const route = readFileSync(new URL('../app/api/[...path]/route.ts', import.meta.url), 'utf8');
  assert.match(route, /const failure = requestFailure\(error\)/);
  assert.match(route, /console\.error\('Studio request failed\.', \{ code: failure\.code \}\)/);
  assert.match(route, /return json\(failure, 400\)/);
});
