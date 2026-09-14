import type { PoolClient } from 'pg';
import { database, withConnection, run, transaction } from '../lib/db';
import { claimJob, enqueueDiscovery } from '../lib/jobs';
import { processImport } from '../lib/process-import';
import { discover } from '../lib/discovery';
import { requestFailure } from '../lib/errors';
import { reportJobFailure } from '../lib/worker-diagnostics';
const pool = database(), workerId = crypto.randomUUID();
let stopping = false;
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });
const sleep = (ms:number) => new Promise(resolve => setTimeout(resolve,ms));
console.log('Research worker started. No files or credentials are written to logs.');
while (!stopping) {
  let client: PoolClient | undefined;
  let locked = false;
  try {
    client = await pool.connect();
    const lock = await client.query('SELECT pg_try_advisory_lock(7246231) locked');
    locked = lock.rows[0].locked;
    if (locked) await withConnection(client, async () => {
      const job = await claimJob();
      await run('INSERT INTO worker_health(id,heartbeat,job_id) VALUES(?,now(),?) ON CONFLICT(id) DO UPDATE SET heartbeat=now(),job_id=excluded.job_id',workerId,job?.id || null);
      if (!job) return;
      let heartbeatPending: Promise<void> | undefined;
      const heartbeat = setInterval(() => {
        // A separate connection keeps health reporting responsive during long SQL.
        if (heartbeatPending) return;
        heartbeatPending = pool.query('UPDATE studio.worker_health SET heartbeat=now() WHERE id=$1',[workerId])
          .then(() => {})
          .catch(error => { console.error('Worker heartbeat failed.', { code: requestFailure(error).code }); })
          .finally(() => { heartbeatPending = undefined; });
      },15000);
      let phase = 'Starting or resuming';
      try {
        const progress = async (text: string) => {
          phase = text;
          await run('UPDATE jobs SET progress=?,updated=now() WHERE id=?',text,job.id);
        };
        const result = job.kind === 'import' ? await processImport(job.batch_id,progress) : await discover(progress, job.id);
        await progress('Saving completed job');
        await transaction(async () => {
          await run("UPDATE jobs SET status='complete',result=?,error=NULL,progress='Complete',updated=now(),finished=now() WHERE id=?",JSON.stringify(result),job.id);
          if (job.kind === 'import') await enqueueDiscovery();
          else {
            await run("INSERT INTO settings(key,value) VALUES('last_scan',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",new Date().toISOString());
            await run("INSERT INTO settings(key,value) VALUES('discovery_stale','false') ON CONFLICT(key) DO UPDATE SET value='false'");
          }
        });
        console.log(`Job ${job.id} complete (${job.kind}).`);
      } catch (error) {
        await reportJobFailure(job, phase, error);
      } finally {
        clearInterval(heartbeat);
        await heartbeatPending;
      }
    });
  } catch (error) {
    console.error('Worker connection interrupted; reconnecting.', { code: requestFailure(error).code });
  }
  finally {
    if (client) {
      // Destroy a connection if unlocking fails; never return a held lock to the pool.
      let destroy = false;
      if (locked) await client.query('SELECT pg_advisory_unlock(7246231)').catch(() => { destroy = true; });
      client.release(destroy);
    }
  }
  if (!stopping) await sleep(3000);
}
await pool.end();
