import assert from 'node:assert/strict';
import { test } from 'node:test';
import pg from 'pg';
import { withConnection, first, run } from '../lib/db';
import { research, validateSpec } from '../lib/research';
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
  });
  await a.query('ROLLBACK');
 } finally {a.release();b.release();await pool.end();}
});
