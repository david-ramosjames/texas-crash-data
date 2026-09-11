import { Button } from '@/components/ui/button';

export type RecoveryBatch = {
  id: string; start: string; end: string; status: string;
  error?: string | null; job_status?: string | null; job_progress?: string | null; job_error?: string | null;
};
export function ImportRecovery({ batch, busy, workerOnline, onResume, onActivity }: {
  batch: RecoveryBatch; busy: boolean; workerOnline: boolean;
  onResume: (batch: RecoveryBatch) => void; onActivity: () => void;
}) {
  if (batch.status === 'complete') return null;
  const active = batch.job_status === 'running' || batch.job_status === 'queued';
  const failed = batch.job_status === 'failed' || batch.status === 'failed';
  return <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
    <p className="fine-print" role="status">
      {active ? (workerOnline ? batch.job_progress || 'Waiting for the worker to process this batch.' : 'Files are queued. Start or reconnect the Railway worker to continue.')
        : failed ? 'Processing stopped. Saved files and verified row checkpoints are preserved.'
        : 'Upload unfinished. Resume checks stored files and asks you to select originals only if needed.'}
    </p>
    {(batch.job_error || batch.error) && <p className="fine-print" role="status"><strong>Last failure:</strong> {batch.job_error || batch.error}</p>}
    <Button type="button" variant="outline" disabled={busy}
      aria-label={`${active ? 'View activity' : 'Resume import'} for ${batch.start} to ${batch.end}`}
      onClick={() => active ? onActivity() : onResume(batch)}>
      {active ? 'View activity' : 'Resume import'}
    </Button>
  </div>;
}
