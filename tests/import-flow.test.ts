import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { withConnection, first, run } from '../lib/db';
import { beginImport, storeRaw } from '../lib/importer';
import { queueImport, claimJob, failJob, resumeImport } from '../lib/jobs';
import { processImport, originalStream } from '../lib/process-import';
import { FILE_TYPES } from '../lib/contracts';
import { identify } from '../lib/csv';
import { uploadFiles } from '../lib/upload';
import { enqueueTimeRepair, repairTimes } from '../lib/time-repair';
import { research, validateSpec, summary } from '../lib/research';
import { cachedSummary } from '../lib/summary-cache';
test('original upload → sealed job → interrupted parsing → resumed activation → byte-identical download',async()=>{
  // HTTP contract double for Supabase Storage. Real SDK calls are exercised,
  // but no account, credentials, real crash files or outbound service are used.
  const objects=new Map<string,Buffer>();
  const server=createServer(async(req,res)=>{
    const path=decodeURIComponent(new URL(req.url!,'http://localhost').pathname);
    res.setHeader('Content-Type','application/json');
    if(req.method==='POST' && path.startsWith('/storage/v1/object/sign/')){
      const key=path.slice('/storage/v1/object/sign/'.length);
      res.end(JSON.stringify({signedURL:'/object/signed/'+key}));return;
    }
    if(path.startsWith('/storage/v1/object/signed/')){
      const bytes=objects.get(path.slice('/storage/v1/object/signed/'.length));
      if(!bytes){res.statusCode=404;res.end('{}');return;}
      res.setHeader('Content-Type','application/octet-stream');res.end(bytes);return;
    }
    if(path.startsWith('/storage/v1/object/info/')){
      const key=path.slice('/storage/v1/object/info/'.length),bytes=objects.get(key);
      if(!bytes){res.statusCode=404;res.end(JSON.stringify({statusCode:404,error:'not_found',message:'not found'}));return;}
      res.end(JSON.stringify({name:key,metadata:{size:bytes.length}}));return;
    }
    if(req.method==='POST' && path.startsWith('/storage/v1/object/')){
      const key=path.slice('/storage/v1/object/'.length),parts:Buffer[]=[];
      for await(const part of req)parts.push(Buffer.from(part));
      if(objects.has(key)){res.statusCode=409;res.end(JSON.stringify({statusCode:409,error:'duplicate',message:'duplicate'}));return;}
      objects.set(key,Buffer.concat(parts));res.end(JSON.stringify({Key:key,Id:'test'}));return;
    }
    res.statusCode=404;res.end('{}');
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  process.env.SUPABASE_URL=`http://127.0.0.1:${(server.address() as any).port}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY='test-only-not-a-real-key';
  const pg=new PGlite();
  await pg.exec(await readFile(new URL('../migrations/001_core.sql',import.meta.url),'utf8'));
  await pg.exec(await readFile(new URL('../migrations/007_research_desk.sql',import.meta.url),'utf8'));
  const connection={query:async(sql:string,args?:any[])=>{const r=await pg.query(sql,args);return {...r,rowCount:r.affectedRows};}};
  try{await withConnection(connection,async()=>{
    const ids=Array.from({length:600},(_,i)=>String(i+1).padStart(6,'0'));
    const content:Record<string,string>={
      crash:'Crash_ID,Crash_Date,City_ID,Cnty_ID,Crash_Sev_ID,At_Intrsct_Fl,Rpt_Street_Name,Rpt_Sec_Street_Name,Crash_Time\n'+ids.map(id=>`${id},12/10/2024,1,1,1,Y,MAIN,OAK,06:00 PM`).join('\n')+'\n',
      unit:'Crash_ID,Unit_Nbr,Unit_Desc_ID,Veh_Body_Styl_ID,Veh_Make_ID,Veh_Color_ID\n'+ids.map(id=>`${id},1,1,106,1,1`).join('\n')+'\n',
      lookup:'ColumnName,ID,Description\nCITY_ID,1,DALLAS\nCNTY_ID,1,DALLAS\nVEH_BODY_STYL_ID,106,TRUCK\nVEH_MAKE_ID,1,FORD\nVEH_COLOR_ID,1,WHITE\n',
    };
    for(const kind of FILE_TYPES)content[kind]??='Crash_ID\n000001\n';
    const files=FILE_TYPES.map(kind=>new File([content[kind]],`extract_public_2023_20260828124847_${kind}_20241210-20241231Texas.csv`));
    const b=await beginImport({files:files.map(f=>({name:f.name,bytes:f.size}))});
    assert.equal((await first<any>('SELECT time_parser_version FROM batches WHERE id=?',b.id)).time_parser_version,2);
    await run('UPDATE batches SET time_parser_version=1 WHERE id=?',b.id); // Legacy interrupted import.
    for(const file of files){const kind=identify(file.name).kind;const req=()=>new Request('http://localhost/raw',{method:'POST',body:file});await storeRaw(b.id,kind,0,req());await storeRaw(b.id,kind,0,req());}
    assert.equal(objects.size,9);
    await assert.rejects(()=>storeRaw(b.id,'charges',0,new Request('http://localhost/raw',{method:'POST',body:new Uint8Array(files.find(f=>identify(f.name).kind==='charges')!.size)})),/differs/);
    await queueImport(b.id);
    const claimed = await claimJob();
    await assert.rejects(()=>storeRaw(b.id,'crash',0,new Request('http://localhost/raw',{method:'POST',body:files[0]})),/immutable|sealed/);
    await assert.rejects(()=>processImport(b.id,async message=>{if(message.includes('500 rows'))throw new Error('Simulated worker interruption');}),/Simulated/);
    assert.equal((await first<any>('SELECT COUNT(*) n FROM crashes')).n,500);
    assert.equal((await first<any>('SELECT COUNT(*) n FROM current_crashes')).n,0);
    await failJob({ ...claimed, attempts: 5 }, 'Simulated worker interruption');
    assert.equal((await resumeImport(b.id)).status, 'queued');
    assert.equal((await claimJob()).id, claimed.id);
    const result=await processImport(b.id,async()=>{});assert.equal((result as any).added,600);
    assert.equal((await first<any>('SELECT COUNT(*) n FROM crashes')).n,600);
    assert.equal((await first<any>('SELECT COUNT(*) n FROM current_crashes')).n,600);
    assert.equal((await first<any>("SELECT city FROM crashes WHERE id='000001'")).city,'DALLAS');
    const original=await new Response(await originalStream(b.id,'crash')).text();assert.equal(original,content.crash);
    assert((await processImport(b.id,async()=>{})).duplicate);
    assert.equal((await first<any>("SELECT hour FROM crashes WHERE id='000001'")).hour,18);
    // Simulate a batch completed by the pre-fix deployment for backfill testing.
    await run('UPDATE batches SET time_parser_version=1 WHERE id=?',b.id);
    await run('UPDATE crashes SET hour=6 WHERE batch_id=?',b.id);
    await run('DELETE FROM time_repairs WHERE batch_id=?',b.id);
    await assert.rejects(()=>research(validateSpec({group:'hour',start:'2024-12-10',end:'2024-12-31'})),/AM\/PM/);
    await summary();const before=await cachedSummary();
    await enqueueTimeRepair();await enqueueTimeRepair();
    assert.equal((await first<any>("SELECT COUNT(*) n FROM jobs WHERE kind='repair_time'")).n,1);
    await assert.rejects(()=>repairTimes(async p=>{if(p.includes('500 rows'))throw new Error('Repair interrupted');}),/interrupted/);
    assert.equal((await first<any>('SELECT rows_done FROM time_repairs')).rows_done,500);
    assert.equal((await first<any>('SELECT time_parser_version FROM batches WHERE id=?',b.id)).time_parser_version,1);
    await repairTimes(async()=>{});
    assert.equal((await first<any>('SELECT changed FROM time_repairs')).changed,600);
    assert.equal((await first<any>('SELECT COUNT(*) n FROM crashes WHERE hour=18')).n,600);
    const after=await cachedSummary();assert.deepEqual(after.value,before.value);assert.notEqual(after.generation,before.generation);
    const hours=await research(validateSpec({group:'hour',start:'2024-12-10',end:'2024-12-31'}));
    assert.equal(hours.rows[0].label,'18:00');assert.equal(hours.timeVersion,2);
    const raw=await first<any>("SELECT key FROM raw_parts WHERE kind='crash'");const key='txdot-originals/'+raw.key;
    const saved=objects.get(key)!;objects.set(key,Buffer.from('corrupted'));
    await assert.rejects(async()=>{const stream=await originalStream(b.id,'crash');await new Response(stream).text();},/checksum/);
    objects.set(key,saved);
  });}finally{await pg.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('browser upload validates all batches first and skips verified chunks on resume',async()=>{
  const files=FILE_TYPES.map(kind=>new File(['test'],`extract_public_2023_20260828124847_${kind}_20241210-20241231Texas.csv`));
  let calls=0;
  await assert.rejects(()=>uploadFiles(files.slice(0,8),async()=>{calls++;},()=>{}),/nine/);assert.equal(calls,0);
  const paths:string[]=[];
  const api=async(path:string,body?:unknown,raw?:Blob)=>{
    paths.push(path);
    if(path==='imports')return {status:'uploading'};
    if(path.endsWith('/parts'))return [];
    if(path.endsWith('/queue'))return {id:'job',status:'queued'};
    assert(raw);return {};
  };
  const reports=await uploadFiles(files,api,()=>{});assert.equal(reports[0].jobId,'job');
  assert.equal(paths.filter(p=>p.includes('/raw?')).length,9);
  assert(!paths.some(p=>p.includes('/rows')||p.includes('/activate')));
});
