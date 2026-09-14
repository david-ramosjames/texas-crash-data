import { all, first, run, db, bucket, transaction, type Statement } from './db';
import { FILE_TYPES } from './contracts';
import { identify } from './csv';
const columns: Record<string, string[]> = {
  crash: [
    'id',
    'date',
    'hour',
    'city',
    'county',
    'road',
    'intersection',
    'severity',
    'cmv',
    'deaths',
    'serious',
    'injuries',
    'latitude',
    'longitude',
    'weather',
    'light',
    'rural',
    'speed',
    'intersection_flag',
  ],
  unit: [
    'crash_id',
    'number',
    'kind',
    'body',
    'make',
    'model',
    'color',
    'year',
    'cmv',
    'factor',
  ],
  lookup: ['column', 'code', 'description'],
};
export const RAW_CHUNK = 8 * 1024 * 1024;
export async function beginImport(input: any) {
  if (!Array.isArray(input.files) || input.files.length !== 9)
    throw new Error(
      'Each batch needs its nine original CSV files. Select all files together; multiple batches are supported.',
    );
  const metas = input.files.map((f: any) => {
    if (
      typeof f.name !== 'string' ||
      !Number.isInteger(f.bytes) ||
      f.bytes < 1 ||
      f.bytes > 2_000_000_000
    )
      throw new Error('Invalid file metadata.');
    return { ...identify(f.name), name: f.name, bytes: f.bytes };
  });
  const firstMeta = metas[0];
  if (
    new Set(metas.map((f: any) => f.id)).size !== 1 ||
    new Set(metas.map((f: any) => f.kind)).size !== 9
  )
    throw new Error('Files must belong to one complete extraction interval.');
  if (firstMeta.start > firstMeta.end)
    throw new Error('Invalid extraction dates.');
  const exists = await first<any>(
    'SELECT * FROM batches WHERE id=?',
    firstMeta.id,
  );
  const manifest = JSON.stringify(
    metas
      .map(({ name, bytes }: any) => ({ name, bytes }))
      .sort((a: any, b: any) => a.name.localeCompare(b.name)),
  );
  if (exists) {
    if (exists.manifest !== manifest)
      throw new Error(
        'This batch identifier already exists with different files. Preserve the original batch or download a newer extraction.',
      );
    return { id: firstMeta.id, status: exists.status, resume: true };
  }
  await db().batch([
    db()
      .prepare(
        'INSERT INTO batches(id,extraction,start,"end",status,created,manifest,time_parser_version) VALUES(?,?,?,?,\'uploading\',?,?,2)',
      )
      .bind(
        firstMeta.id,
        firstMeta.extraction,
        firstMeta.start,
        firstMeta.end,
        new Date().toISOString(),
        manifest,
      ),
    ...metas.map((f: any) =>
      db()
        .prepare('INSERT INTO files(batch_id,kind,name,bytes) VALUES(?,?,?,?)')
        .bind(f.id, f.kind, f.name, f.bytes),
    ),
  ]);
  return { id: firstMeta.id, status: 'uploading', resume: false };
}
async function activeBatch(id: string, kind: string) {
  if (!FILE_TYPES.includes(kind as any)) throw new Error('Invalid file type.');
  const b = await first<any>('SELECT * FROM batches WHERE id=?', id);
  if (!b) throw new Error('Unknown upload batch.');
  if (!['uploading','processing'].includes(b.status))
    throw new Error('This batch is already activated and immutable.');
  return b;
}
export async function storeRaw(
  id: string,
  kind: string,
  part: number,
  request: Request,
) {
  const batch = await activeBatch(id, kind);
  if (batch.status !== 'uploading') throw new Error('Uploads are sealed while processing.');
  const file = await first<any>(
    'SELECT * FROM files WHERE batch_id=? AND kind=?',
    id,
    kind,
  );
  const expected = Math.ceil(file.bytes / RAW_CHUNK);
  if (!Number.isInteger(part) || part < 0 || part >= expected)
    throw new Error('Invalid file chunk.');
  const size =
    part === expected - 1 ? file.bytes - part * RAW_CHUNK : RAW_CHUNK;
  const declared = request.headers.get('content-length');
  if (declared && Number(declared) !== size)
    throw new Error('File chunk length mismatch.');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('File chunk body required.');
  const chunks: Uint8Array[] = []; let received = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    received += value.byteLength;
    if (received > size) { await reader.cancel(); throw new Error('File chunk length mismatch.'); }
    chunks.push(value);
  }
  const bytes = new ArrayBuffer(received), target = new Uint8Array(bytes); let offset = 0;
  for (const chunk of chunks) { target.set(chunk, offset); offset += chunk.length; }
  if (bytes.byteLength !== size) throw new Error('File chunk length mismatch.');
  const hash = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
  )
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
  const key = `raw/${id}/${kind}/${part}-${hash}`;
  const old = await first<any>('SELECT sha256 FROM raw_parts WHERE batch_id=? AND kind=? AND part=?', id,kind,part);
  if (old && old.sha256 !== hash)
    throw new Error(
      'The original file differs from the already uploaded chunk.',
    );
  if (!old)
    await bucket().put(key, bytes);
  await transaction(async () => {
    const sealed = await first<any>('SELECT status FROM batches WHERE id=? FOR UPDATE', id);
    if (sealed.status !== 'uploading') throw new Error('Uploads are sealed while processing.');
    await run('INSERT INTO raw_parts(batch_id,kind,part,key,sha256,bytes) VALUES(?,?,?,?,?,?) ON CONFLICT DO NOTHING',id,kind,part,key,hash,size);
    const saved = await first<any>('SELECT sha256 FROM raw_parts WHERE batch_id=? AND kind=? AND part=?',id,kind,part);
    if (saved.sha256 !== hash) throw new Error('Concurrent upload content conflict.');
    await run('UPDATE files SET parts=(SELECT COUNT(*) FROM raw_parts WHERE batch_id=? AND kind=?) WHERE batch_id=? AND kind=?',id,kind,id,kind);
  });
  return { part, sha256: hash };
}
export async function storeRows(id: string, kind: string, input: any) {
  const batch = await activeBatch(id, kind);
  const { number, rows } = input;
  if (
    !Number.isInteger(number) ||
    number < 0 ||
    !Array.isArray(rows) ||
    rows.length < 1 ||
    rows.length > 500
  )
    throw new Error('Invalid row chunk.');
  const json = JSON.stringify(rows);
  if (json.length > 900000) throw new Error('Row chunk is too large.');
  const digest = Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json)),
    ),
  )
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
  const old = await first<any>(
    'SELECT * FROM chunks WHERE batch_id=? AND kind=? AND number=?',
    id,
    kind,
    number,
  );
  if (old) {
    if (old.digest !== digest)
      throw new Error('A resumed row chunk differs from the original.');
    return { rows: old.rows, resumed: true };
  }
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row))
      throw new Error('Invalid record.');
    for (const [key, v] of Object.entries(row)) {
      if (
        (typeof v === 'object' && v !== null) ||
        (typeof v === 'string' && v.length > 5000) ||
        (typeof v === 'number' && !Number.isFinite(v))
      )
        throw new Error(`Invalid ${key} value.`);
    }
    if (kind === 'crash') {
      if (
        !/^\d+$/.test(row.id) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(row.date) ||
        row.date < batch.start ||
        row.date > batch.end
      )
        throw new Error(
          'Crash identifier or date is outside the batch interval.',
        );
    } else if (kind === 'lookup') {
      if (
        !row.column ||
        row.code === undefined ||
        typeof row.description !== 'string'
      )
        throw new Error('Invalid lookup row.');
    } else if (!/^\d+$/.test(row.crash_id))
      throw new Error('Invalid child Crash_ID.');
  }
  if (!['crash', 'lookup'].includes(kind)) {
    const invalid = await first<any>(
      "SELECT COUNT(*) n FROM jsonb_array_elements(?::jsonb) j WHERE NOT EXISTS(SELECT 1 FROM crashes c WHERE c.batch_id=? AND c.id=j.value->>'crash_id')",
      json,
      id,
    );
    if (invalid.n)
      throw new Error(
        `${invalid.n} child records refer to missing crashes. Upload the matching crash file first.`,
      );
  }
  const statements: Statement[] = [];
  if (columns[kind]) {
    const table =
      kind === 'crash' ? 'crashes' : kind === 'unit' ? 'units' : 'lookups';
    const keys = columns[kind];
    statements.push(
      db()
        .prepare(
          `INSERT INTO ${table}(batch_id,${keys.map((x) => `"${x}"`).join(',')}) SELECT ?,${keys.map((x) => `"${x}"`).join(',')} FROM jsonb_populate_recordset(NULL::${table},?::jsonb)`,
        )
        .bind(id, json),
    );
  }
  statements.push(
    db()
      .prepare(
        'INSERT INTO chunks(batch_id,kind,number,rows,digest) VALUES(?,?,?,?,?)',
      )
      .bind(id, kind, number, rows.length, digest),
  );
  statements.push(
    db()
      .prepare('UPDATE files SET rows=rows+? WHERE batch_id=? AND kind=?')
      .bind(rows.length, id, kind),
  );
  await db().batch(statements);
  return { rows: rows.length };
}
export async function finishFile(id: string, kind: string, input: any) {
  await activeBatch(id, kind);
  const f = await first<any>(
    'SELECT * FROM files WHERE batch_id=? AND kind=?',
    id,
    kind,
  );
  if (!Number.isInteger(input.rows) || input.rows !== f.rows)
    throw new Error('Parsed row count does not match uploaded rows.');
  const chunkStats = await first<any>(
    'SELECT COUNT(*) n,MAX(number) last FROM chunks WHERE batch_id=? AND kind=?',
    id,
    kind,
  );
  if (input.rows > 0 && chunkStats.n !== chunkStats.last + 1)
    throw new Error('A parsed row chunk is missing.');
  const parts = Math.ceil(f.bytes / RAW_CHUNK);
  for (let i = 0; i < parts; i++) {
    const part = await first<any>('SELECT key FROM raw_parts WHERE batch_id=? AND kind=? AND part=?',id,kind,i);
    if (!part || !(await bucket().head(part.key)))
      throw new Error(`Original file chunk ${i + 1} is missing.`);
  }
  await run('UPDATE files SET parsed=1 WHERE batch_id=? AND kind=?', id, kind);
  return { rows: f.rows };
}
export async function activate(id: string) {
  const b = await first<any>('SELECT * FROM batches WHERE id=?', id);
  if (!b) throw new Error('Unknown batch.');
  if (b.status === 'complete') return { status: 'complete', duplicate: true };
  const fs = await all<any>('SELECT * FROM files WHERE batch_id=?', id);
  if (fs.length !== 9 || fs.some((f) => !f.parsed))
    throw new Error(
      'All nine files must finish uploading and validation before activation.',
    );
  for (const k of ['crash', 'unit', 'lookup'])
    if (!fs.find((f) => f.kind === k)?.rows)
      throw new Error(`The ${k} file has no records.`);
  const ckeys = columns.crash
    .filter((x) => x !== 'id')
    .map((x) => `n."${x}" IS DISTINCT FROM o."${x}"`)
    .join(' OR ');
  const conflict = await first<any>(
    `SELECT COUNT(*) n FROM crashes n JOIN current_crashes cc ON cc.id=n.id AND cc.extraction=? JOIN crashes o ON o.batch_id=cc.batch_id AND o.id=cc.id WHERE n.batch_id=? AND (${ckeys})`,
    b.extraction,
    id,
  );
  if (conflict.n)
    throw new Error(
      'Conflicting crash records share the same extraction timestamp. Obtain a newer original extract; upload order will not decide which record is correct.',
    );
  const ukeys = columns.unit
    .filter((x) => !['crash_id', 'number'].includes(x))
    .map((x) => `n."${x}" IS DISTINCT FROM o."${x}"`)
    .join(' OR ');
  const unitConflict = await first<any>(
    `SELECT COUNT(*) n FROM units n JOIN current_crashes cc ON cc.id=n.crash_id AND cc.extraction=? LEFT JOIN units o ON o.batch_id=cc.batch_id AND o.crash_id=n.crash_id AND o.number=n.number WHERE n.batch_id=? AND (o.number IS NULL OR ${ukeys})`,
    b.extraction,
    id,
  );
  const missingUnits = await first<any>(
    `SELECT COUNT(*) n FROM crashes c JOIN current_crashes cc ON cc.id=c.id AND cc.extraction=? JOIN units o ON o.batch_id=cc.batch_id AND o.crash_id=c.id WHERE c.batch_id=? AND NOT EXISTS(SELECT 1 FROM units n WHERE n.batch_id=c.batch_id AND n.crash_id=c.id AND n.number=o.number)`,
    b.extraction,
    id,
  );
  if (unitConflict.n || missingUnits.n)
    throw new Error(
      'Conflicting vehicle records share the same extraction timestamp. Obtain a newer original extract.',
    );
  const updates = await first<any>(
    'SELECT COUNT(*) n FROM crashes c JOIN current_crashes cc ON cc.id=c.id WHERE c.batch_id=? AND cc.extraction<?',
    id,
    b.extraction,
  );
  const added = await first<any>(
    'SELECT COUNT(*) n FROM crashes c WHERE c.batch_id=? AND NOT EXISTS(SELECT 1 FROM current_crashes cc WHERE cc.id=c.id)',
    id,
  );
  await db().batch([
    // Invalidate cached analytics atomically with the active revision switch.
    db().prepare("INSERT INTO settings(key,value) VALUES('summary_generation',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(crypto.randomUUID()),
    db()
      .prepare(
        'INSERT INTO current_crashes(id,batch_id,extraction) SELECT id,?,? FROM crashes WHERE batch_id=? ON CONFLICT(id) DO UPDATE SET batch_id=excluded.batch_id,extraction=excluded.extraction WHERE excluded.extraction>current_crashes.extraction',
      )
      .bind(id, b.extraction, id),
    db()
      .prepare("UPDATE batches SET status='complete',activated=? WHERE id=?")
      .bind(new Date().toISOString(), id),
    db().prepare(
      "UPDATE settings SET value='true' WHERE key='discovery_stale'",
    ),
  ]);
  await run(
    "INSERT INTO settings(key,value) VALUES('discovery_stale','true') ON CONFLICT(key) DO UPDATE SET value='true'",
  );
  return { status: 'complete', added: added.n, updated: updates.n };
}
