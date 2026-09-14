import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { CSVParser, readCSV, identify, normalize } from '../lib/csv';
import { validateSpec, compile, research, summary, covers, completeMonths, interpret } from '../lib/research';
import { escapeHTML, exportCSV, renderPage } from '../lib/export';
import { all, first, run, withConnection, parameters, transaction } from '../lib/db';
import { beginImport, storeRows, activate } from '../lib/importer';
import { queueImport, enqueueDiscovery, claimJob, failJob, retryJob } from '../lib/jobs';
import { FILE_TYPES, GROUPS, COHORTS } from '../lib/contracts';
import { discover } from '../lib/discovery';
import { discoveryCheckpoints } from '../lib/discovery-checkpoints';
import { allowedUser, sameOrigin } from '../lib/auth';

test('RFC4180 parser preserves identifiers and handles all chunk boundaries',async()=>{
  const input='id,text\r\n001,"a,b"\r\n002,"a""b\nline"\r\n';
  for(let size=1;size<18;size++){
    const p=new CSVParser();let rows:string[][]=[];
    for(let i=0;i<input.length;i+=size) rows.push(...p.feed(input.slice(i,i+size)));
    rows.push(...p.feed('',true)); assert.deepEqual(rows,[['id','text'],['001','a,b'],['002','a"b\nline']]);
  }
  assert.throws(()=>new CSVParser().feed('a,"oops',true));
  const rows=[];for await(const r of readCSV(new Blob(['Crash_ID,Zip\n0001,00123\n'])))rows.push(r);
  assert.equal(rows[0].Zip,'00123');assert.throws(()=>identify('crashes.xlsx'));
});
test('query allowlists, dates, coverage and literal-safe parameter binding',()=>{
  assert.equal(parameters("SELECT '?' x, \"?\" FROM t WHERE a=? AND b=?"),"SELECT '?' x, \"?\" FROM t WHERE a=$1 AND b=$2");
  const spec={cohort:'all',group:'city',metric:'crashes',start:'2024-12-01',end:'2024-12-31',min:1,limit:10};
  for(const group of ['__proto__','constructor','city; DROP TABLE crashes'])assert.throws(()=>validateSpec({...spec,group}));
  assert.throws(()=>validateSpec({...spec,start:'2024-02-30'}));
  const q=compile(validateSpec({...spec,city:"DALLAS'; DELETE FROM crashes;--"}));
  assert(!q.sql.includes('DELETE'));assert(q.args.includes("DALLAS'; DELETE FROM crashes;--"));
  assert(!covers('2024-12-01','2024-12-31',[{start:'2024-12-10',end:'2024-12-31'}]));
  assert.deepEqual(completeMonths([{start:'2024-12-10',end:'2024-12-31'}]),[]);
  assert.throws(()=>interpret('latest complete month',{start:'2024-12-10',end:'2024-12-31',cities:['DALLAS'],completeMonths:[]}));
});
test('private auth allowlist and strict same-origin checks fail closed',()=>{
  process.env.STUDIO_ALLOWED_EMAILS='editor@example.com'; process.env.APP_URL='https://studio.example.com';
  assert(allowedUser('EDITOR@example.com'));assert(!allowedUser('visitor@example.com'));assert(!allowedUser());
  assert(sameOrigin(new Request('http://internal:3000/api/research',{headers:{origin:'https://studio.example.com'}})));
  assert(!sameOrigin(new Request('http://internal:3000/api/research')));
  assert(!sameOrigin(new Request('https://studio.example.com/api/research',{headers:{origin:'https://evil.example'}})));
});
test('export escapes markup and spreadsheet formulas',()=>{
  assert.equal(escapeHTML('<script>"'),'&lt;script&gt;&quot;');
  assert(exportCSV({evidence:{rows:[{label:'=HYPERLINK("evil")',crashes:1,severe:0,fatal:0,deaths:0,serious:0}]}} as any).includes("'=HYPERLINK"));
});

test('PostgreSQL ingestion, revision precedence, jobs, discovery and all research dimensions',async(t)=>{
 const pg = new PGlite();
 await pg.exec(await readFile(new URL('../migrations/001_core.sql',import.meta.url),'utf8'));
 await pg.exec(await readFile(new URL('../migrations/004_discovery_checkpoints.sql',import.meta.url),'utf8'));
 const connection={query:async(sql:string,args?:any[])=>{const r=await pg.query(sql,args);return {...r,rowCount:r.affectedRows};}};
 try { await withConnection(connection,async()=>{
  const makeBatch=async(extraction:string,start='20241210',end='20241231')=>{
    const files=FILE_TYPES.map(kind=>({name:`extract_public_2023_${extraction}_${kind}_${start}-${end}Texas.csv`,bytes:10}));
    return beginImport({files});
  };
  const b=await makeBatch('20260828124847');
  assert.equal((await makeBatch('20260828124847')).resume,true);
  await t.test('partial batches cannot activate or queue',async()=>{
    await assert.rejects(()=>activate(b.id));await assert.rejects(()=>queueImport(b.id));
    assert.equal((await summary()).crashes,0);
  });
  const crashes=Array.from({length:36},(_,i)=>({id:String(i+1).padStart(4,'0'),date:'2024-12-10',hour:8,city:'DALLAS',county:'DALLAS',road:'MAIN ST',intersection:'MAIN ST & OAK ST',severity:i<5?4:1,cmv:1,deaths:i<5?1:0,serious:i<5?0:1,injuries:1,latitude:32.78,longitude:-96.8,weather:'CLEAR',light:'DAYLIGHT',rural:'N',speed:35,intersection_flag:1}));
  const units=crashes.flatMap(c=>[1,2].map(n=>({crash_id:c.id,number:String(n),kind:1,body:106,make:n===1?'FORD':'CHEVROLET',model:'TRUCK',color:'WHITE',year:2020,cmv:1,factor:'NOT REPORTED'})));
  await storeRows(b.id,'crash',{number:0,rows:crashes});
  await t.test('replayed row chunks are idempotent; changed chunks and missing parents rejected',async()=>{
    assert((await storeRows(b.id,'crash',{number:0,rows:crashes})).resumed);
    await assert.rejects(()=>storeRows(b.id,'crash',{number:0,rows:[{...crashes[0],city:'AUSTIN'}]}));
    await assert.rejects(()=>storeRows(b.id,'unit',{number:0,rows:[{...units[0],crash_id:'999999'}]}));
  });
  await storeRows(b.id,'unit',{number:0,rows:units});
  await storeRows(b.id,'lookup',{number:0,rows:[{column:'VEH_BODY_STYL_ID',code:'106',description:'TRUCK'}]});
  for(const kind of FILE_TYPES) await run('INSERT INTO raw_parts(batch_id,kind,part,key,sha256,bytes) VALUES(?,?,0,?,?,10)',b.id,kind,kind,'synthetic-hash');
  const job=await queueImport(b.id);assert.equal((await queueImport(b.id)).id,job.id);
  const claimed=await claimJob();assert.equal(claimed.attempts,1);
  await run('UPDATE files SET parsed=1 WHERE batch_id=?',b.id);
  const activated=await activate(b.id);assert.equal(activated.added,36);
  await run("UPDATE jobs SET status='complete' WHERE id=?",job.id);
  await t.test('every cohort/dimension compiles and runs on PostgreSQL with no vehicle join inflation',async()=>{
    for(const cohort of Object.keys(COHORTS)) for(const group of Object.keys(GROUPS)){
      const e=await research(validateSpec({cohort,group,metric:'crashes',start:'2024-12-10',end:'2024-12-31',min:1,limit:10}));
      if(['all','truck','cmv'].includes(cohort)) assert.equal(e.total,36,cohort+':'+group);
      if(group==='body' && e.total) assert.equal(e.rows[0].label,'TRUCK');
    }
    const s=await summary();assert.equal(s.crashes,36);assert.equal(s.fatal,5);assert.equal(s.located,36);
  });
  await t.test('transaction rolls back partial changes',async()=>{
    await assert.rejects(()=>transaction(async()=>{await run("INSERT INTO settings VALUES('rollback','test')");throw new Error('stop');}));
    assert.equal(await first("SELECT * FROM settings WHERE key='rollback'"),null);
  });
  await t.test('older revisions do not replace current; equal-timestamp conflicts rejected',async()=>{
    const older=await makeBatch('20250828124847');
    await storeRows(older.id,'crash',{number:0,rows:[{...crashes[0],city:'AUSTIN'}]});
    await storeRows(older.id,'unit',{number:0,rows:[units[0]]});
    await storeRows(older.id,'lookup',{number:0,rows:[{column:'x',code:'1',description:'x'}]});
    await run('UPDATE files SET parsed=1 WHERE batch_id=?',older.id);await activate(older.id);
    assert.equal((await first<any>('SELECT batch_id FROM current_crashes WHERE id=?',crashes[0].id)).batch_id,b.id);
    const conflict=await makeBatch('20260828124847','20241201','20241231');
    await storeRows(conflict.id,'crash',{number:0,rows:[{...crashes[0],city:'AUSTIN'}]});
    await storeRows(conflict.id,'unit',{number:0,rows:[units[0]]});
    await storeRows(conflict.id,'lookup',{number:0,rows:[{column:'x',code:'1',description:'x'}]});
    await run('UPDATE files SET parsed=1 WHERE batch_id=?',conflict.id);await assert.rejects(()=>activate(conflict.id),/Conflicting/);
  });
  await t.test('discovery preserves human editorial decisions and produces backed findings',async()=>{
    const phases:string[]=[];
    const result=await discover(async phase=>{phases.push(phase);});assert(result.created>0);assert.equal(result.comparisons,0);
    assert.match(phases[0],/^Summary:/);
    assert(phases.includes('Selecting city cohorts · Ranking groups'));
    assert(phases.some(p=>/^Question 1\/\d+: all by city · Ranking groups$/.test(p)));
    assert(phases.some(p=>/^Question 1\/\d+: all by city · Saving finding$/.test(p)));
    assert(phases.includes('Question 2/27: all by intersection · Counting matching crashes'));
    assert.equal(phases.at(-1),'Discovery questions finished; preparing results');
    const f=await first<any>('SELECT * FROM findings LIMIT 1');
    await run("UPDATE findings SET status='dismissed' WHERE id=?",f.id);
    await discover();assert.equal((await first<any>('SELECT status FROM findings WHERE id=?',f.id)).status,'dismissed');
  });
  await t.test('coalesced jobs, interrupted-worker reclamation, retries and terminal failure',async()=>{
    const j=await enqueueDiscovery();assert.equal((await enqueueDiscovery()).id,j.id);
    const claimed=await claimJob();assert.equal(claimed.id,j.id);
    const restarted=await claimJob();assert.equal(restarted.id,j.id);assert.equal(restarted.attempts,2);
    const diagnostic='At Question 2: intersection. [code: 57014] The database query was cancelled or timed out.';
    await failJob(restarted,diagnostic);
    await run('UPDATE jobs SET available_at=now() WHERE id=?',j.id);
    const autoRetry=await claimJob();assert.equal(autoRetry.attempts,3);assert.equal(autoRetry.error,diagnostic);
    assert.equal((await first<any>('SELECT error FROM jobs WHERE id=?',j.id)).error,diagnostic);
    await failJob({...autoRetry,attempts:5},diagnostic);
    assert.equal((await first<any>('SELECT status FROM jobs WHERE id=?',j.id)).status,'failed');
    await retryJob(j.id);
    const manualRetry=await claimJob();assert.equal(manualRetry.attempts,1);assert.equal(manualRetry.error,diagnostic);
    await run('UPDATE jobs SET attempts=5 WHERE id=?',j.id);
    assert.equal(await claimJob(),null);
    const terminal=await first<any>('SELECT status,error FROM jobs WHERE id=?',j.id);
    assert.equal(terminal.status,'failed');assert.equal(terminal.error,diagnostic);
  });
  await t.test('body-style join preserves correlated-lookup results and exact vehicle filtering',async()=>{
    // Different codes may share a description; multiple vehicles in a crash
    // must still count only once per displayed body-style label.
    await run("INSERT INTO lookups VALUES(?, 'VEH_BODY_STYL_ID','87','TRUCK')",b.id);
    await run("INSERT INTO lookups SELECT id,'VEH_BODY_STYL_ID','106','OTHER BATCH DESCRIPTION' FROM batches WHERE id<>?",b.id);
    await run("INSERT INTO units SELECT batch_id,crash_id,'3',kind,87,make,model,color,year,cmv,factor FROM units WHERE batch_id=? AND crash_id=? AND number='1'",b.id,crashes[0].id);
    await run("INSERT INTO units SELECT batch_id,crash_id,'4',kind,NULL,make,model,color,year,cmv,factor FROM units WHERE batch_id=? AND crash_id=? AND number='1'",b.id,crashes[0].id);
    await run("INSERT INTO units SELECT batch_id,crash_id,'5',kind,999,make,model,color,year,cmv,factor FROM units WHERE batch_id=? AND crash_id=? AND number='1'",b.id,crashes[0].id);
    for(const filter of [{},{cohort:'truck'},{make:'FORD',color:'WHITE'},{make:'CHEVROLET'},{make:'absent'}]) {
      const spec=validateSpec({cohort:'all',group:'body',metric:'crashes',start:'2024-12-10',end:'2024-12-31',min:1,limit:10,...filter});
      const q=compile(spec);
      assert(!q.sql.includes('SELECT description FROM lookups'));
      const oldSQL=q.sql.replace("COALESCE(body_lookup.description,'Not recorded')", "COALESCE((SELECT description FROM lookups l WHERE l.batch_id=c.batch_id AND l.column='VEH_BODY_STYL_ID' AND l.code=CAST(u.body AS TEXT)),'Not recorded')")
        .replace(" LEFT JOIN lookups body_lookup ON body_lookup.batch_id=c.batch_id AND body_lookup.column='VEH_BODY_STYL_ID' AND body_lookup.code=CAST(u.body AS TEXT)",'');
      assert.deepEqual(await all(q.sql,...q.args),await all(oldSQL,...q.args));
    }
    const rows=await research(validateSpec({group:'body',start:'2024-12-10',end:'2024-12-31',min:1,limit:10}));
    assert.equal(rows.rows.find(r=>r.label==='TRUCK')?.crashes,36);
    assert.equal(rows.rows.find(r=>r.label==='Not recorded')?.crashes,1);
  });
  let checkpointJobId:string;
  await t.test('timeout on question 24 resumes there without repeating the first 23 questions',async()=>{
    const job=await enqueueDiscovery();checkpointJobId=job.id;await claimJob();
    const timeout=Object.assign(new Error('synthetic timeout'),{code:'57014'});
    await assert.rejects(()=>withConnection({query:async(sql:string,args?:any[])=>{
      if(sql.includes('WITH matched') && sql.includes('body_lookup'))throw timeout;
      return connection.query(sql,args);
    }},()=>discover(async()=>{},job.id)),timeout);
    const cp=await discoveryCheckpoints(job.id);
    assert.equal(await cp.read('probe',{cohort:'all',group:'body',metric:'crashes',category:'Conditions & patterns',start:'2024-12-10',end:'2024-12-10',min:10,limit:10}),null);
    // Mimic worker failure and explicit retry; checkpoints must survive both.
    await failJob({...job,attempts:5},'At Question 24/27. [code: 57014]');
    await run("UPDATE findings SET title='Human-edited title',status='approved' WHERE id='finding-all-city-severe'");
    await retryJob(job.id);await claimJob();
    const phases:string[]=[],queries:string[]=[];
    const result=await withConnection({query:async(sql:string,args?:any[])=>{
      if(sql.includes('WITH matched'))queries.push(sql);
      return connection.query(sql,args);
    }},()=>discover(async p=>{phases.push(p);},job.id));
    assert.equal(result.resumed,23);assert.equal(result.probes,27);
    assert(phases.includes('Question 24/27: all by body · Ranking groups'));
    assert(!phases.some(p=>/^Question (?:[1-9]|1\d|2[0-3])\/27:.*Ranking groups$/.test(p)));
    assert.equal(queries.length,4);
    assert.equal((await first<any>("SELECT title FROM findings WHERE id='finding-all-city-severe'")).title,'Human-edited title');
    assert.equal((await first<any>("SELECT status FROM findings WHERE id='finding-all-city-severe'")).status,'approved');
    const replay=await discover(async()=>{},job.id);
    assert.equal(replay.resumed,27);assert.equal(replay.created,result.created);assert.equal(replay.refreshed,result.refreshed);
    await run("UPDATE jobs SET status='complete' WHERE id=?",job.id);
  });
  await t.test('pedestrian hour analysis resumes individual SQL stages after counting and source timeouts',async()=>{
    const cp=await discoveryCheckpoints(checkpointJobId);
    const spec=validateSpec({cohort:'pedestrian',group:'hour',city:'Dallas',metric:'crashes',start:'2024-12-10',end:'2024-12-31',min:1,limit:10});
    const counts={ranking:0,totals:0,sources:0};
    let fail='totals';
    const connection={query:async(sql:string,args?:any[])=>{
      const stage=sql.startsWith('WITH matched')?'ranking':sql.startsWith('SELECT COUNT(*) total')?'totals':sql.startsWith('SELECT DISTINCT b.id')?'sources':null;
      if(stage){counts[stage]++;if(stage===fail)throw Object.assign(new Error('synthetic timeout'),{code:'57014'});}
      return pg.query(sql,args);
    }};
    const attempt=()=>withConnection(connection,()=>research(spec,async()=>{},
      (stage,task)=>cp.query('research-stage-v1',{spec,stage},stage,async()=>{},task)));
    await assert.rejects(attempt,{code:'57014'});
    fail='sources';await assert.rejects(attempt,{code:'57014'});
    fail='';const resumed=await attempt();
    assert.deepEqual(counts,{ranking:1,totals:2,sources:2});
    const fresh=await research(spec);
    assert.deepEqual({...resumed,generated:''},{...fresh,generated:''});
    await attempt();assert.deepEqual(counts,{ranking:1,totals:2,sources:2});
  });
  await t.test('checkpoint and finding writes roll back together, and input identity is canonical',async()=>{
    const cp=await discoveryCheckpoints(checkpointJobId);
    await assert.rejects(()=>cp.commit('rollback',{a:1,b:2},async()=>{
      await run("INSERT INTO settings VALUES('checkpoint-rollback','test')");throw new Error('simulated save failure');
    }),/simulated save/);
    assert.equal(await first("SELECT * FROM settings WHERE key='checkpoint-rollback'"),null);
    assert.equal(await cp.read('rollback',{a:1,b:2}),null);
    await assert.rejects(()=>withConnection({query:async(sql:string,args?:any[])=>{
      if(sql.startsWith('INSERT INTO discovery_checkpoints'))throw new Error('checkpoint storage failed');
      return connection.query(sql,args);
    }},()=>cp.commit('save-fails',{},async()=>{
      await run("INSERT INTO settings VALUES('checkpoint-rollback','test')");return {created:1};
    })),/checkpoint storage failed/);
    assert.equal(await first("SELECT * FROM settings WHERE key='checkpoint-rollback'"),null);
    assert.equal(await cp.read('save-fails',{}),null);
    const saved={nested:{z:1,a:2},rows:[{label:'example',crashes:1}]};
    await cp.query('canonical',{a:1,b:2},'test',async()=>{},async()=>saved);
    const reused=await cp.query('canonical',{b:2,a:1},'test',async()=>{},async()=>{throw new Error('must reuse');});
    assert.equal(JSON.stringify(reused),JSON.stringify(saved));
    const other=await enqueueDiscovery();
    assert.equal(await (await discoveryCheckpoints(other.id)).read('canonical',{a:1,b:2}),null);
    await run("UPDATE jobs SET status='complete' WHERE id=?",other.id);
    await run("UPDATE discovery_checkpoints SET version='old-code' WHERE job_id=?",checkpointJobId);
    assert.equal(await cp.read('canonical',{a:1,b:2}),null);
    await cp.query('current-generation',{},'test',async()=>{},async()=>saved);
  });
  await t.test('newer activation invalidates saved totals atomically; duplicates keep the cache',async()=>{
    assert.equal((await summary()).fatal,5);
    const newer=await makeBatch('20270828124847');
    await storeRows(newer.id,'crash',{number:0,rows:[{...crashes[0],city:'AUSTIN',severity:3,deaths:0}]});
    await storeRows(newer.id,'unit',{number:0,rows:units.filter(u=>u.crash_id===crashes[0].id)});
    await storeRows(newer.id,'lookup',{number:0,rows:[{column:'x',code:'1',description:'x'}]});
    await run('UPDATE files SET parsed=1 WHERE batch_id=?',newer.id);
    await activate(newer.id);
    const freshCheckpoints=await discoveryCheckpoints(checkpointJobId);
    assert.equal(await freshCheckpoints.read('current-generation',{}),null);
    assert.equal((await summary(undefined,{cachedOnly:true})).ready,false);
    const updated=await summary();assert.equal(updated.crashes,36);assert.equal(updated.fatal,4);
    assert(updated.cities.includes('AUSTIN'));
    await activate(newer.id);
    assert.equal((await summary(undefined,{cachedOnly:true})).ready,true);
  });
 }); } finally { await pg.close(); }
});
