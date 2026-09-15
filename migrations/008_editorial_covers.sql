ALTER TABLE studio.drafts ADD COLUMN cover_id text;
ALTER TABLE studio.jobs DROP CONSTRAINT jobs_kind_check;
ALTER TABLE studio.jobs ADD CONSTRAINT jobs_kind_check CHECK(kind IN ('import','discover','repair_time','propose','research','cover'));
CREATE TABLE studio.editorial_covers (
 id text PRIMARY KEY, draft_id text NOT NULL REFERENCES studio.drafts(id),
 job_id text NOT NULL UNIQUE REFERENCES studio.jobs(id), storage_key text NOT NULL UNIQUE,
 mime text NOT NULL CHECK(mime='image/jpeg'), bytes integer NOT NULL CHECK(bytes>0 AND bytes<=10000000),
 alt text NOT NULL, prompt text NOT NULL, model text NOT NULL, created timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX editorial_covers_draft ON studio.editorial_covers(draft_id,created);
CREATE UNIQUE INDEX one_pending_cover_per_draft ON studio.jobs((payload::jsonb->>'draftId')) WHERE kind='cover' AND status IN ('queued','running');
ALTER TABLE studio.editorial_covers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON studio.editorial_covers FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON studio.editorial_covers FROM anon; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON studio.editorial_covers FROM authenticated; END IF;
END $$;
