-- The studio is single-workspace, authenticated at the server boundary.
-- It is deliberately NOT exposed through Supabase's public Data API.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
   REVOKE ALL ON SCHEMA studio FROM anon, authenticated;
   REVOKE ALL ON ALL TABLES IN SCHEMA studio FROM anon, authenticated;
 END IF;
END $$;
