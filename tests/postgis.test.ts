import assert from 'node:assert/strict';
import { test } from 'node:test';
import pg from 'pg';
import { withConnection, all, first, run } from '../lib/db';
import { compile, research, validateSpec } from '../lib/research';
test('native PostgreSQL: PostGIS generated points, radius queries, privacy grants and worker locks',{skip:!process.env.TEST_DATABASE_URL},async()=>{
 const pool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL,options:'-c search_path=studio,extensions,public'});
 const a=await pool.connect(),b=await pool.connect();
 try {
  assert((await a.query('SELECT PostGIS_Version() version')).rows[0].version);
  assert.equal((await a.query("SELECT COUNT(*) n FROM pg_tables WHERE schemaname='studio' AND NOT rowsecurity")).rows[0].n,0);
  await a.query('SELECT pg_advisory_lock(7246231)');
  assert.equal((await b.query('SELECT pg_try_advisory_lock(7246231) locked')).rows[0].locked,false);
  await a.query('SELECT pg_advisory_unlock(7246231)');
  assert.equal((await b.query('SELECT pg_try_advisory_lock(7246231) locked')).rows[0].locked,true);
  await b.query('SELECT pg_advisory_unlock(7246231)');
  await a.query('BEGIN');
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
  });
  await a.query('ROLLBACK');
 } finally {a.release();b.release();await pool.end();}
});
