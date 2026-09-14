import { all, first } from './db';
import { sourceBatches } from './research';

export async function activity() {
  // No crash scans or finding/draft evidence payloads in the polling endpoint.
  const jobs = await all('SELECT * FROM jobs ORDER BY created DESC LIMIT 40');
  const worker = await first("SELECT heartbeat,job_id,(heartbeat>now()-interval '60 seconds') online FROM worker_health ORDER BY heartbeat DESC LIMIT 1");
  const batches = await sourceBatches();
  const revision = await all("SELECT key,value FROM settings WHERE key IN ('summary_generation','summary_cached_generation','last_scan','desk_revision') ORDER BY key");
  return { jobs, worker, batches, revision: JSON.stringify(revision) };
}
