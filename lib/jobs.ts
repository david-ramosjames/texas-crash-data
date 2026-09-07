import { all, first, run, transaction } from './db';
import { RAW_CHUNK } from './importer';
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
    const files = await all<any>('SELECT * FROM files WHERE batch_id=?',id);
    if (files.length !== 9) throw new Error('All nine files are required.');
    for (const file of files) {
      const stats = await first<any>('SELECT COUNT(*) n,MIN(part) first,MAX(part) last,SUM(bytes) bytes FROM raw_parts WHERE batch_id=? AND kind=?',id,file.kind);
      if (Number(stats.n) !== Math.ceil(Number(file.bytes)/RAW_CHUNK) || stats.first !== 0 || stats.last !== Number(stats.n)-1 || Number(stats.bytes) !== Number(file.bytes))
        throw new Error(`${file.kind}: finish uploading every original file chunk before processing.`);
    }
    const job = await first<any>("INSERT INTO jobs(id,kind,batch_id) VALUES(?,'import',?) RETURNING *",crypto.randomUUID(),id);
    await run("UPDATE batches SET status='queued',error=NULL WHERE id=?",id);
    return job;
  });
}
export async function retryJob(id: string) {
  return transaction(async () => {
    const job = await first<any>('SELECT * FROM jobs WHERE id=? FOR UPDATE',id);
    if (!job || job.status !== 'failed') throw new Error('Only failed jobs can be retried.');
    await run("UPDATE jobs SET status='queued',attempts=0,error=NULL,available_at=now(),updated=now(),progress='Retry requested',finished=NULL WHERE id=?",id);
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
      await failJob(job, 'The worker was interrupted repeatedly. Check worker resources and retry.', true);
      return null;
    }
    await run("UPDATE jobs SET status='running',attempts=attempts+1,updated=now(),progress='Starting or resuming',error=NULL WHERE id=?",job.id);
    return { ...job, attempts:job.attempts+1 };
  });
}
export async function failJob(job: any, message: string, terminal = false) {
  const failed = terminal || job.attempts >= 5;
  await run(`UPDATE jobs SET status=?,error=?,progress=?,updated=now(),available_at=now()+(? * interval '1 second') WHERE id=?`,
    failed ? 'failed':'queued',message,failed ? 'Needs attention':'Will retry automatically',Math.min(300,10*2**job.attempts),job.id);
  if (job.batch_id) await run('UPDATE batches SET status=?,error=? WHERE id=?',failed?'failed':'queued',message,job.batch_id);
}
