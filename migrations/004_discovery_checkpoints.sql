CREATE TABLE studio.discovery_checkpoints (
  job_id text NOT NULL REFERENCES studio.jobs(id) ON DELETE CASCADE,
  generation text NOT NULL,
  version text NOT NULL,
  step_key text NOT NULL,
  value text NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(job_id,generation,version,step_key)
);
ALTER TABLE studio.discovery_checkpoints ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE studio.discovery_checkpoints FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON TABLE studio.discovery_checkpoints FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON TABLE studio.discovery_checkpoints FROM authenticated;
  END IF;
END $$;
