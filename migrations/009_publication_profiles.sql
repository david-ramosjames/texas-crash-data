-- Preserve existing profiles (including www aliases), IDs, custom colors and draft associations.
INSERT INTO studio.domains (id,name,host,byline,color)
SELECT p.id,p.name,p.host,p.byline,p.color FROM (VALUES
 ('publication-trucking-chicas','Trucking Chicas','truckingchicas.com','Trucking Chicas Research Team','#e53935'),
 ('publication-ramos-james','Ramos James Law','ramosjames.com','Ramos James Law Research Team','#011e4d'),
 ('publication-find-austin-lawyer','Find Austin Lawyer','findaustinlawyer.com','Find Austin Lawyer Research Team','#174b75')
) AS p(id,name,host,byline,color)
WHERE NOT EXISTS (
 SELECT 1 FROM studio.domains d
 WHERE regexp_replace(lower(d.host),'^www\.','')=p.host
)
ON CONFLICT DO NOTHING;
