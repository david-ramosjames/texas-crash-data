-- Social design controls are small, validated JSON; reference images are never stored here.
ALTER TABLE studio.drafts ADD COLUMN social_json text NOT NULL DEFAULT '{}';
CREATE TABLE studio.social_references (
 id text PRIMARY KEY, draft_id text NOT NULL REFERENCES studio.drafts(id), storage_key text NOT NULL UNIQUE,
 mime text NOT NULL CHECK(mime IN ('image/png','image/jpeg')), bytes integer NOT NULL CHECK(bytes>0 AND bytes<=8000000),
 created timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE studio.drafts ADD COLUMN social_reference_id text REFERENCES studio.social_references(id);
ALTER TABLE studio.social_references ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON studio.social_references FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON studio.social_references FROM anon; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON studio.social_references FROM authenticated; END IF;
END $$;
