import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PGlite } from '@electric-sql/pglite';
import { withConnection, first, run } from '../lib/db';
import { beginImport } from '../lib/importer';
import { resumeImport, claimJob, failJob } from '../lib/jobs';
import { FILE_TYPES } from '../lib/contracts';
import { identify } from '../lib/csv';
import { uploadFiles, validateResumeSelection } from '../lib/upload';
import { ImportRecovery } from '../components/import-recovery';

const files = () => FILE_TYPES.map(kind => new File(['original'], `extract_public_2023_20260828124847_${kind}_20241210-20241231Texas.csv`));

test('resume safely handles missing originals, interrupted queueing, failed jobs and completed batches', async () => {
  const pg = new PGlite();
  await pg.exec(await readFile(new URL('../migrations/001_core.sql', import.meta.url), 'utf8'));
  try { await withConnection({ query: async (sql, args) => { const r = await pg.query(sql, args); return { ...r, rowCount: r.affectedRows }; } }, async () => {
    await assert.rejects(() => resumeImport('missing'), /Unknown import batch/);
    const batch = await beginImport({ files: files().map(f => ({ name: f.name, bytes: f.size })) });
    const incomplete = await resumeImport(batch.id);
    assert.equal(incomplete.status, 'needs_files');
    assert.equal(incomplete.missing?.length, 9);
    assert.equal((await first<any>('SELECT COUNT(*) n FROM jobs')).n, 0);
    for (const kind of FILE_TYPES.filter(kind => kind !== 'charges'))
      await run('INSERT INTO raw_parts(batch_id,kind,part,key,sha256,bytes) VALUES(?,?,0,?,?,8)', batch.id, kind, kind, 'test');
    assert.deepEqual((await resumeImport(batch.id)).missing, ['charges']);
    // Matching byte totals alone are not enough: parts must start at zero and be contiguous.
    await run("INSERT INTO raw_parts(batch_id,kind,part,key,sha256,bytes) VALUES(?,'charges',1,'charges','test',8)", batch.id);
    assert.deepEqual((await resumeImport(batch.id)).missing, ['charges']);
    await run("UPDATE raw_parts SET part=0 WHERE batch_id=? AND kind='charges'", batch.id);
    const queued = await resumeImport(batch.id);
    assert.equal(queued.status, 'queued');
    assert.equal((await resumeImport(batch.id)).jobId, queued.jobId);
    assert.equal((await first<any>('SELECT COUNT(*) n FROM jobs')).n, 1);
    const job = await claimJob();
    assert.equal((await resumeImport(batch.id)).status, 'running');
    assert.equal((await first<any>('SELECT attempts FROM jobs WHERE id=?', job.id)).attempts, 1);
    await run("INSERT INTO chunks(batch_id,kind,number,rows,digest) VALUES(?,'crash',0,500,'saved-checkpoint')", batch.id);
    await run("UPDATE files SET parsed=1 WHERE batch_id=? AND kind='crash'", batch.id);
    await failJob({ ...job, attempts: 5 }, 'Simulated connection interruption');
    assert.equal((await resumeImport(batch.id)).status, 'queued');
    assert.equal((await first<any>('SELECT attempts FROM jobs WHERE id=?', job.id)).attempts, 0);
    assert.equal((await first<any>('SELECT SUM(rows) n FROM chunks')).n, 500);
    assert.equal((await first<any>("SELECT parsed FROM files WHERE kind='crash'")).parsed, 1);
    assert.equal((await first<any>('SELECT COUNT(*) n FROM raw_parts')).n, 9);
    await run("UPDATE batches SET status='complete' WHERE id=?", batch.id);
    await run("UPDATE jobs SET status='complete' WHERE id=?", job.id);
    assert.equal((await resumeImport(batch.id)).status, 'complete');
    assert.equal((await first<any>('SELECT COUNT(*) n FROM jobs')).n, 1);
  }); } finally { await pg.close(); }
});

test('resume selection only accepts the same complete nine-file batch', () => {
  const selected = files(), id = identify(selected[0].name).id;
  validateResumeSelection(selected, id);
  assert.throws(() => validateResumeSelection(selected.slice(0, 8), id), /same nine/);
  assert.throws(() => validateResumeSelection([...selected.slice(0, 8), selected[0]], id), /same nine/);
  assert.throws(() => validateResumeSelection(selected, 'different-batch'), /same nine/);
});

test('resumed upload verifies and skips stored bytes, rejects changed originals and queues once', async () => {
  const selected = files();
  const digest = createHash('sha256').update('original').digest('hex');
  const paths: string[] = [];
  const api = async (path: string) => {
    paths.push(path);
    if (path === 'imports') return { status: 'uploading' };
    if (path.endsWith('/parts')) return FILE_TYPES.map(kind => ({ kind, part: 0, sha256: digest }));
    if (path.endsWith('/queue')) return { id: 'job', status: 'queued' };
    throw new Error('No raw uploads expected');
  };
  await uploadFiles(selected, api, () => {});
  assert.equal(paths.filter(path => path.endsWith('/queue')).length, 1);
  assert.ok(!paths.some(path => path.includes('/raw')));
  paths.length = 0;
  await assert.rejects(() => uploadFiles([new File(['modified'], selected[0].name), ...selected.slice(1)], api, () => {}), /differs/);
  assert.ok(!paths.some(path => path.endsWith('/queue')));
});

test('incomplete batch UI exposes recovery and current worker state, not a dead-end Pending label', () => {
  const base = { id: 'batch', start: '2024-12-10', end: '2024-12-31', status: 'uploading' };
  const render = (batch: typeof base & { job_status?: string; job_error?: string }, busy = false, workerOnline = true) => renderToStaticMarkup(createElement(ImportRecovery, {
    batch, busy, workerOnline, onResume: () => {}, onActivity: () => {},
  }));
  assert.match(render(base), />Resume import<\/button>/);
  assert.match(render({ ...base, status: 'failed', job_status: 'failed', job_error: 'Connection interrupted' }), /Connection interrupted/);
  assert.match(render({ ...base, status: 'queued', job_status: 'queued' }, false, false), /reconnect the Railway worker/);
  assert.match(render({ ...base, status: 'processing', job_status: 'running' }), />View activity<\/button>/);
  assert.match(render(base, true), /disabled/);
  assert.equal(render({ ...base, status: 'complete' }), '');
});
