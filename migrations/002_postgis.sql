CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;
SET search_path TO studio, extensions, public;
ALTER TABLE crashes ADD COLUMN location geography(Point,4326)
 GENERATED ALWAYS AS (CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL
 THEN ST_SetSRID(ST_MakePoint(longitude,latitude),4326)::geography ELSE NULL END) STORED;
CREATE INDEX crashes_location ON crashes USING gist(location);
