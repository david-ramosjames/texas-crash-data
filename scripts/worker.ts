import { database, withConnection, first, run, transaction } from '../lib/db';
import { claimJob, failJob, enqueueDiscovery } from '../lib/jobs';
import { processImport } from '../lib/process-import';
import { discover } from '../lib/discovery';
const pool = database(), workerId = crypto.randomUUID();
let stopping = false;
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });
const sleep = (ms:number) => new Promise(resolve => setTimeout(resolve,ms));
console.log('Research worker started. No files or credentials are written to logs.');
while (!stopping) {
  const client = await pool.connect();
  let locked = false;
  try {
    const lock = await client.query('SELECT pg_try_advisory_lock(7246231) locked');
    locked = lock.rows[0].locked;
    if (locked) await withConnection(client, async () => {
      const job = await claimJob();
      await run('INSERT INTO worker_health(id,heartbeat,job_id) VALUES(?,now(),?) ON CONFLICT(id) DO UPDATE SET heartbeat=now(),job_id=excluded.job_id',workerId,job?.id || null);
      if (!job) return;
      const heartbeat = setInterval(() => {
        // A separate connection keeps health reporting responsive during long SQL.
        pool.query('UPDATE studio.worker_health SET heartbeat=now() WHERE id=$1',[workerId]).catch(() => {});
      },15000);
      try {
        const progress = async (text: string) => { await run('UPDATE jobs SET progress=?,updated=now() WHERE id=?',text,job.id); };
        const result = job.kind === 'import' ? await processImport(job.batch_id,progress) : await discover();
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
        // Detailed validation errors are private to the authenticated job inbox.
        const message = error instanceof Error ? error.message : 'Job failed.';
        await failJob(job,message.slice(0,1000));
        console.error(`Job ${job.id} failed; see the private activity inbox.`);
      } finally { clearInterval(heartbeat); }
    });
  } catch { console.error('Worker connection interrupted; reconnecting. Check configuration if this persists.'); }
  finally {
    if (locked) await client.query('SELECT pg_advisory_unlock(7246231)').catch(() => {});
    client.release();
  }
  if (!stopping) await sleep(3000);
}
await pool.end();
