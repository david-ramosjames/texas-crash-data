import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { withConnection, run, first } from '../lib/db';
import { summary } from '../lib/research';
import { activity } from '../lib/activity';

test('paged summary caches exact active totals; web reads and activity polling never scan crash tables', async () => {
  const pg = new PGlite();
  await pg.exec(await readFile(new URL('../migrations/001_core.sql', import.meta.url), 'utf8'));
  const queries: string[] = [];
  const connection = { query: async (sql: string, args?: any[]) => {
    queries.push(sql); const r = await pg.query(sql, args); return { ...r, rowCount: r.affectedRows };
  } };
  try { await withConnection(connection, async () => {
    await run("INSERT INTO batches(id,extraction,start,\"end\",status,created,manifest) VALUES('batch','20260101','2024-01-01','2024-01-31','complete','2026-01-01','{}')");
    await run(`INSERT INTO crashes(batch_id,id,date,hour,city,county,road,intersection,severity,cmv,deaths,serious,injuries,latitude,weather,light,rural,speed,intersection_flag)
      SELECT 'batch',lpad(n::text,6,'0'),'2024-01-01',8,CASE WHEN n%2=0 THEN 'DALLAS' ELSE 'AUSTIN' END,'COUNTY','MAIN','MAIN & OAK',
        CASE WHEN n%2=0 THEN 4 ELSE 1 END,1,CASE WHEN n%2=0 THEN 1 ELSE 0 END,0,0,CASE WHEN n%2=0 THEN 32.5 ELSE NULL END,'CLEAR','DAYLIGHT','N',30,1
      FROM generate_series(1,10003) n`);
    await run("INSERT INTO current_crashes SELECT id,batch_id,'20260101' FROM crashes");
    queries.length = 0;
    const pending = await summary(undefined, { cachedOnly: true });
    assert.equal(pending.ready, false); assert.equal(pending.batches.length, 1);
    await activity();
    assert(!queries.some(q => /\b(current_crashes|JOIN crashes)\b/.test(q)));

    const phases: string[] = [];
    const built = await summary(async p => { phases.push(p); });
    assert.equal(built.ready, true); assert.equal(built.crashes, 10003);
    assert.equal(built.severe, 10003); assert.equal(built.fatal, 5001);
    assert.equal(built.located, 5001); assert.equal(built.deaths, 5001);
    assert.equal(built.cmv, 10003); assert.deepEqual(built.cities, ['AUSTIN','DALLAS']);
    assert.equal(built.start, '2024-01-01'); assert.equal(built.end, '2024-01-01');
    assert(phases.includes('Summary: counting loaded crashes · 10,000 counted'));
    assert.equal(queries.filter(q => q.startsWith('WITH page')).length, 2);
    const version = (await activity()).revision;
    queries.length = 0;
    assert.equal((await summary()).crashes, 10003);
    assert.equal((await summary(undefined, { cachedOnly: true })).crashes, 10003);
    await activity();
    assert(!queries.some(q => /\b(current_crashes|JOIN crashes)\b/.test(q)));

    // Simulate the atomic activation generation change. A stale cache is never
    // presented as current, and activity notices without reading cached totals.
    await run("UPDATE settings SET value='new-generation' WHERE key='summary_generation'");
    assert.notEqual((await activity()).revision, version);
    assert.equal((await summary(undefined, { cachedOnly: true })).ready, false);
    await run("UPDATE crashes SET deaths=2 WHERE id='000002'");
    assert.equal((await summary()).deaths, 5002);

    // If a different activation occurs between pages and publication, discard
    // the in-progress build rather than persist mixed-generation counts.
    await run("UPDATE settings SET value='generation-three' WHERE key='summary_generation'");
    await assert.rejects(() => summary(async phase => {
      if (phase === 'Summary: saving verified totals') await run("UPDATE settings SET value='generation-four' WHERE key='summary_generation'");
    }), /Imported data changed/);
    assert.equal((await summary(undefined, { cachedOnly: true })).ready, false);
    const saved = await first<any>("SELECT value FROM settings WHERE key='summary_cached_generation'");
    assert.equal(saved.value, 'new-generation');
  }); } finally { await pg.close(); }
});
