import assert from 'node:assert/strict';
import { test } from 'node:test';
import pg from 'pg';
import { withConnection, all, first, run } from '../lib/db';
import { compile, research, validateSpec } from '../lib/research';
import { bodyAnalysis } from '../lib/body-research';
import { applyIndexMigration } from '../lib/index-migration';
import { readFile } from 'node:fs/promises';
test('native PostgreSQL: PostGIS generated points, radius queries, privacy grants and worker locks',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,options:'-c search_path=studio,extensions,public'});
 const a=await pool.connect(),b=await pool.connect();
 try {
  assert((await a.query('SELECT PostGIS_Version() version')).rows[0].version);
  for(const name of ['005_city_research','006_unit_kind_research']) {
    const source=await readFile(new URL(`../migrations/${name}.index.json`,import.meta.url),'utf8');
    await applyIndexMigration(a,source); // Verify real catalog shape and safe replay after CI migrations.
    assert.equal((await a.query("SELECT i.indisvalid valid FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='studio' AND c.relname=$1",[JSON.parse(source).name])).rows[0].valid,true);
  }
  assert.equal((await a.query("SELECT COUNT(*) n FROM pg_tables WHERE schemaname='studio' AND NOT rowsecurity")).rows[0].n,0);
  await a.query('SELECT pg_advisory_lock(7246231)');
  assert.equal((await b.query('SELECT pg_try_advisory_lock(7246231) locked')).rows[0].locked,false);
  await a.query('SELECT pg_advisory_unlock(7246231)');
  assert.equal((await b.query('SELECT pg_try_advisory_lock(7246231) locked')).rows[0].locked,true);
  await b.query('SELECT pg_advisory_unlock(7246231)');
  await a.query('BEGIN');
  // Prove expression/kind predicates can use the new indexes; this is not a
  // production benchmark or a promise about the optimizer's live plan.
  await a.query('SET LOCAL enable_seqscan=off');
  const cityPlan=await a.query("EXPLAIN (FORMAT JSON) SELECT * FROM studio.crashes WHERE upper(city)=upper('Dallas')");
  assert.match(JSON.stringify(cityPlan.rows),/crashes_city_upper_date/);
  const kindPlan=await a.query('EXPLAIN (FORMAT JSON) SELECT batch_id,crash_id FROM studio.units WHERE kind=4');
  assert.match(JSON.stringify(kindPlan.rows),/units_kind_crash/);
  await a.query('SET LOCAL enable_seqscan=on');
  await withConnection(a,async()=>{
   await run(`INSERT INTO batches(id,extraction,start,"end",status,created,manifest) VALUES('geo-test','20260101000000','2024-01-01','2024-01-31','complete','2026-01-01','[]')`);
   for(const [id,lat,lon] of [['1',32.78,-96.8],['2',29.76,-95.36],['3',null,null]]) {
    await run(`INSERT INTO crashes(batch_id,id,date,hour,city,county,road,intersection,severity,cmv,deaths,serious,injuries,latitude,longitude,weather,light,rural,speed,intersection_flag)
      VALUES('geo-test',?,'2024-01-10',8,'DALLAS','DALLAS','TEST','',1,0,0,1,1,?,?,'CLEAR','DAYLIGHT','N',30,0)`,id,lat,lon);
    await run("INSERT INTO current_crashes VALUES(?,'geo-test','20260101000000')",id);
   }
   const e=await research(validateSpec({cohort:'all',group:'city',metric:'crashes',start:'2024-01-01',end:'2024-01-31',latitude:32.78,longitude:-96.8,radiusMeters:500,min:1,limit:10}));
   assert.equal(e.total,1);assert.equal(e.rows[0].crashes,1);
   assert.equal((await first<any>("SELECT COUNT(location) n FROM crashes WHERE batch_id='geo-test'")).n,2);
   await run("INSERT INTO lookups VALUES('geo-test','VEH_BODY_STYL_ID','106','TRUCK')");
   for(const number of ['1','2']) await run("INSERT INTO units(batch_id,crash_id,number,kind,body,make,model,color,cmv,factor) VALUES('geo-test','1',?,1,106,'FORD','TEST','WHITE',1,'TEST')",number);
   const bodySpec=validateSpec({cohort:'all',group:'body',metric:'crashes',start:'2024-01-01',end:'2024-01-31',min:1,limit:10});
   const body=await research(bodySpec);
   assert.equal(body.rows[0].label,'TRUCK');assert.equal(body.rows[0].crashes,1);
   const bodyQuery=compile(bodySpec);
   const plan=await all('EXPLAIN (FORMAT JSON) '+bodyQuery.sql,...bodyQuery.args);
   assert(!JSON.stringify(plan).includes('SubPlan'), 'Body labels must use the set-based lookup join');
   let pageQuery: { sql: string; args?: any[] } | undefined;
   const bounded = await withConnection({ query: async (sql: string, args?: any[]) => {
     if (sql.startsWith('WITH crash_page')) pageQuery = { sql, args };
     return a.query(sql,args);
   } }, () => bodyAnalysis(validateSpec({...bodySpec,make:'FORD',color:'WHITE',latitude:32.78,longitude:-96.8,radiusMeters:500}),async()=>{},async(_key,task)=>task(),2));
   assert.equal(bounded.rows[0].crashes,1);assert.equal(bounded.totals.total,1);
   assert(pageQuery);
   await a.query('SET LOCAL enable_seqscan=off');
   const boundedPlan=await a.query('EXPLAIN (FORMAT JSON) '+pageQuery.sql,pageQuery.args);
   const planText=JSON.stringify(boundedPlan.rows);
   assert.match(planText,/current_crashes_pkey/);assert.match(planText,/crashes_pkey/);assert.match(planText,/units_pkey/);assert.match(planText,/lookups_pkey/);
   assert.match(planText,/Limit/);
   await a.query('SET LOCAL enable_seqscan=on');
  });
  await a.query('ROLLBACK');
 } finally {a.release();b.release();await pool.end();}
});
