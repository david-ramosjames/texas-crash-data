CREATE SCHEMA IF NOT EXISTS studio;
REVOKE ALL ON SCHEMA studio FROM PUBLIC;
SET search_path TO studio, public;
CREATE TABLE batches (
 id text PRIMARY KEY, extraction text NOT NULL, start text NOT NULL, "end" text NOT NULL,
 status text NOT NULL DEFAULT 'uploading' CHECK(status IN ('uploading','queued','processing','complete','failed')),
 created text NOT NULL, activated text, manifest text NOT NULL, error text
);
CREATE TABLE files (
 batch_id text NOT NULL REFERENCES batches(id), kind text NOT NULL, name text NOT NULL,
 bytes bigint NOT NULL, parts integer NOT NULL DEFAULT 0, rows integer NOT NULL DEFAULT 0,
 parsed integer NOT NULL DEFAULT 0, PRIMARY KEY(batch_id,kind)
);
CREATE TABLE raw_parts (
 batch_id text NOT NULL, kind text NOT NULL, part integer NOT NULL,
 key text NOT NULL, sha256 text NOT NULL, bytes integer NOT NULL,
 PRIMARY KEY(batch_id,kind,part), FOREIGN KEY(batch_id,kind) REFERENCES files(batch_id,kind)
);
CREATE TABLE chunks (
 batch_id text NOT NULL, kind text NOT NULL, number integer NOT NULL, rows integer NOT NULL, digest text NOT NULL,
 PRIMARY KEY(batch_id,kind,number), FOREIGN KEY(batch_id,kind) REFERENCES files(batch_id,kind)
);
CREATE TABLE crashes (
 batch_id text NOT NULL REFERENCES batches(id), id text NOT NULL, date text NOT NULL, hour integer,
 city text NOT NULL, county text NOT NULL, road text NOT NULL, intersection text NOT NULL,
 severity integer, cmv integer NOT NULL, deaths integer NOT NULL, serious integer NOT NULL, injuries integer NOT NULL,
 latitude double precision, longitude double precision, weather text NOT NULL, light text NOT NULL,
 rural text NOT NULL, speed integer, intersection_flag integer NOT NULL, PRIMARY KEY(batch_id,id)
);
CREATE INDEX crashes_date ON crashes(date);
CREATE INDEX crashes_city_date ON crashes(city,date);
CREATE INDEX crashes_county_date ON crashes(county,date);
CREATE TABLE current_crashes (
 id text PRIMARY KEY, batch_id text NOT NULL, extraction text NOT NULL,
 FOREIGN KEY(batch_id,id) REFERENCES crashes(batch_id,id)
);
CREATE INDEX current_batch ON current_crashes(batch_id);
CREATE TABLE units (
 batch_id text NOT NULL, crash_id text NOT NULL, number text NOT NULL,
 kind integer, body integer, make text NOT NULL, model text NOT NULL, color text NOT NULL,
 year integer, cmv integer NOT NULL, factor text NOT NULL,
 PRIMARY KEY(batch_id,crash_id,number), FOREIGN KEY(batch_id,crash_id) REFERENCES crashes(batch_id,id)
);
CREATE INDEX units_body ON units(body,batch_id,crash_id);
CREATE TABLE lookups (
 batch_id text NOT NULL REFERENCES batches(id), "column" text NOT NULL, code text NOT NULL, description text NOT NULL,
 PRIMARY KEY(batch_id,"column",code)
);
CREATE TABLE findings (
 id text PRIMARY KEY, signature text NOT NULL, title text NOT NULL, category text NOT NULL,
 summary text NOT NULL, score integer NOT NULL, status text NOT NULL DEFAULT 'new',
 evidence text NOT NULL, created text NOT NULL, updated text NOT NULL
);
CREATE INDEX findings_status ON findings(status);
CREATE TABLE domains (id text PRIMARY KEY, name text NOT NULL, host text NOT NULL UNIQUE, byline text NOT NULL, color text NOT NULL);
CREATE TABLE drafts (
 id text PRIMARY KEY, finding_id text REFERENCES findings(id), title text NOT NULL, slug text NOT NULL,
 channel text NOT NULL, domain_id text REFERENCES domains(id), body text NOT NULL, status text NOT NULL DEFAULT 'draft',
 evidence text NOT NULL, created text NOT NULL, updated text NOT NULL
);
CREATE UNIQUE INDEX draft_url ON drafts(COALESCE(domain_id,''),slug);
CREATE TABLE queries (id text PRIMARY KEY, question text NOT NULL, spec text NOT NULL, result text NOT NULL, created text NOT NULL);
CREATE TABLE settings (key text PRIMARY KEY, value text NOT NULL);
CREATE TABLE jobs (
 id text PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('import','discover')), batch_id text REFERENCES batches(id),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','complete','failed')),
 attempts integer NOT NULL DEFAULT 0, progress text NOT NULL DEFAULT 'Waiting for worker',
 result text, error text, created timestamptz NOT NULL DEFAULT now(), updated timestamptz NOT NULL DEFAULT now(),
 available_at timestamptz NOT NULL DEFAULT now(), finished timestamptz
);
CREATE INDEX jobs_ready ON jobs(status,available_at,created);
CREATE UNIQUE INDEX one_import_per_batch ON jobs(batch_id) WHERE kind='import';
CREATE UNIQUE INDEX one_pending_discovery ON jobs(kind) WHERE kind='discover' AND status IN ('queued','running');
CREATE TABLE worker_health (id text PRIMARY KEY, heartbeat timestamptz NOT NULL, job_id text);
DO $$ DECLARE t record; BEGIN
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='studio' LOOP
   EXECUTE format('ALTER TABLE studio.%I ENABLE ROW LEVEL SECURITY',t.tablename);
   EXECUTE format('REVOKE ALL ON TABLE studio.%I FROM PUBLIC',t.tablename);
 END LOOP;
END $$;
