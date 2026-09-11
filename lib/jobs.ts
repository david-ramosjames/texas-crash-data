import { all, first, run, transaction } from './db';
import { RAW_CHUNK } from './importer';
async function missingOriginals(id: string) {
  const files = await all<any>('SELECT * FROM files WHERE batch_id=?', id);
  if (files.length !== 9) throw new Error('All nine files are required.');
  const missing: string[] = [];
  for (const file of files) {
    const stats = await first<any>('SELECT COUNT(*) n,MIN(part) first,MAX(part) last,SUM(bytes) bytes FROM raw_parts WHERE batch_id=? AND kind=?', id, file.kind);
    if (Number(stats.n) !== Math.ceil(Number(file.bytes) / RAW_CHUNK) || stats.first !== 0 || stats.last !== Number(stats.n) - 1 || Number(stats.bytes) !== Number(file.bytes)) missing.push(file.kind);
  }
  return missing;
}

// An explicit user action: retry failed work, queue stored originals, or ask for missing files.
// Never reset a running job, delete checkpoints, or activate an unvalidated batch.
export async function resumeImport(id: string) {
  return transaction(async () => {
    const job = await first<any>("SELECT * FROM jobs WHERE kind='import' AND batch_id=? FOR UPDATE", id);
    const batch = await first<any>('SELECT status FROM batches WHERE id=?', id);
    if (!batch) throw new Error('Unknown import batch.');
    if (batch.status === 'complete') return { status: 'complete' };
    if (job) {
      if (job.status === 'failed') {
        await retryJob(job.id);
        return { status: 'queued', jobId: job.id };
      }
      if (job.status === 'queued' || job.status === 'running') return { status: job.status, jobId: job.id };
      throw new Error('Import status is inconsistent. Contact support; no data was changed.');
    }
    if (batch.status !== 'uploading') throw new Error('Import has no processing job. Contact support; no data was changed.');
    const missing = await missingOriginals(id);
    if (missing.length) return { status: 'needs_files', missing };
    const queued = await queueImport(id);
    return { status: queued.status, jobId: queued.id };
  });
}
export async function enqueueDiscovery() {
  return transaction(async () => {
    const id = crypto.randomUUID();
    const added = await first<any>("INSERT INTO jobs(id,kind) VALUES(?,'discover') ON CONFLICT DO NOTHING RETURNING *",id);
    return added || await first<any>("SELECT * FROM jobs WHERE kind='discover' AND status IN ('queued','running')");
  });
}
export async function queueImport(id: string) {
  return transaction(async () => {
    const batch = await first<any>('SELECT * FROM batches WHERE id=? FOR UPDATE',id);
    if (!batch) throw new Error('Unknown import batch.');
    const existing = await first<any>("SELECT * FROM jobs WHERE kind='import' AND batch_id=?",id);
    if (existing) return existing;
    if (batch.status !== 'uploading') throw new Error('Batch cannot be queued in its current state.');
    const missing = await missingOriginals(id);
    if (missing.length) throw new Error(`${missing.join(', ')}: finish uploading every original file chunk before processing.`);
    const job = await first<any>("INSERT INTO jobs(id,kind,batch_id) VALUES(?,'import',?) RETURNING *",crypto.randomUUID(),id);
    await run("UPDATE batches SET status='queued',error=NULL WHERE id=?",id);
    return job;
  });
}
export async function retryJob(id: string) {
  return transaction(async () => {
    const job = await first<any>('SELECT * FROM jobs WHERE id=? FOR UPDATE',id);
    if (!job || job.status !== 'failed') throw new Error('Only failed jobs can be retried.');
    // Keep the last failure until success; retrying must not hide the diagnosis.
    await run("UPDATE jobs SET status='queued',attempts=0,available_at=now(),updated=now(),progress='Retry requested',finished=NULL WHERE id=?",id);
    if (job.batch_id) await run("UPDATE batches SET status='queued',error=NULL WHERE id=?",job.batch_id);
    return { queued: true };
  });
}
// Caller holds the global worker session lock. A running job here is an interrupted job.
export async function claimJob() {
  return transaction(async () => {
    const job = await first<any>(`SELECT * FROM jobs WHERE status='running' OR (status='queued' AND available_at<=now())
      ORDER BY CASE WHEN status='running' THEN 0 WHEN kind='import' THEN 1 ELSE 2 END,created FOR UPDATE SKIP LOCKED LIMIT 1`);
    if (!job) return null;
    if (job.attempts >= 5) {
      await failJob(job, job.error || 'The worker was interrupted repeatedly. Check worker resources and retry.', true);
      return null;
    }
    // Preserve error across automatic retries as well as explicit retries.
    await run("UPDATE jobs SET status='running',attempts=attempts+1,updated=now(),progress='Starting or resuming' WHERE id=?",job.id);
    return { ...job, attempts:job.attempts+1 };
  });
}
export async function failJob(job: any, message: string, terminal = false) {
  const failed = terminal || job.attempts >= 5;
  await run(`UPDATE jobs SET status=?,error=?,progress=?,updated=now(),available_at=now()+(? * interval '1 second') WHERE id=?`,
    failed ? 'failed':'queued',message,failed ? 'Needs attention':'Will retry automatically',Math.min(300,10*2**job.attempts),job.id);
  if (job.batch_id) await run('UPDATE batches SET status=?,error=? WHERE id=?',failed?'failed':'queued',message,job.batch_id);
}
