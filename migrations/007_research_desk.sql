ALTER TABLE studio.batches ADD COLUMN time_parser_version integer NOT NULL DEFAULT 1;
CREATE TABLE studio.time_repairs (
 batch_id text PRIMARY KEY REFERENCES studio.batches(id),
 rows_done integer NOT NULL DEFAULT 0, changed integer NOT NULL DEFAULT 0,
 complete boolean NOT NULL DEFAULT false
);
ALTER TABLE studio.jobs DROP CONSTRAINT jobs_kind_check;
ALTER TABLE studio.jobs ADD CONSTRAINT jobs_kind_check CHECK(kind IN ('import','discover','repair_time','propose','research'));
ALTER TABLE studio.jobs ADD COLUMN payload text NOT NULL DEFAULT '{}';
ALTER TABLE studio.jobs ADD COLUMN label text;
CREATE UNIQUE INDEX one_pending_repair ON studio.jobs(kind) WHERE kind='repair_time' AND status IN ('queued','running');
CREATE UNIQUE INDEX one_pending_proposal ON studio.jobs(kind) WHERE kind='propose' AND status IN ('queued','running');
CREATE TABLE studio.research_ideas (
 id text PRIMARY KEY, signature text NOT NULL UNIQUE, question text NOT NULL,
 rationale text NOT NULL, source text NOT NULL, demand text,
 spec text NOT NULL, status text NOT NULL DEFAULT 'suggested'
 CHECK(status IN ('suggested','queued','complete','dismissed')),
 job_id text REFERENCES studio.jobs(id), finding_id text REFERENCES studio.findings(id),
 created timestamptz NOT NULL DEFAULT now(), updated timestamptz NOT NULL DEFAULT now()
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['time_repairs','research_ideas'] LOOP
  EXECUTE format('ALTER TABLE studio.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON studio.%I FROM PUBLIC',t);
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON studio.%I FROM anon',t); END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON studio.%I FROM authenticated',t); END IF;
 END LOOP;
END $$;
