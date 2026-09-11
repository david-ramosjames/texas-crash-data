import { requestFailure } from './errors';
import { failJob } from './jobs';

// Phases are application-generated labels, never SQL, row data, or error messages.
export async function reportJobFailure(
  job: { id: string; kind: string; attempts: number; batch_id?: string },
  phase: string,
  error: unknown,
  persist = failJob,
  log: (message: string, details: Record<string, unknown>) => void = console.error,
) {
  const failure = requestFailure(error);
  const metadata = { jobId: job.id, kind: job.kind, attempt: job.attempts, phase, code: failure.code };
  // Log first: a read-only database or lost connection may also reject failJob.
  log('Research job failed.', metadata);
  const message = `At ${phase}. [code: ${failure.code}] ${failure.error.replace(/ \[code: [^\]]+\]$/, '')}`.slice(0, 1000);
  try {
    await persist(job, message);
  } catch (persistenceError) {
    log('Could not save job failure; see preceding failure code.', {
      jobId: job.id, code: requestFailure(persistenceError).code,
    });
    throw persistenceError;
  }
}
