import { all, first, run, bucket } from './db';
import { readCSV, normalize, type Lookup } from './csv';
import { storeRows, finishFile, activate } from './importer';
import { createHash } from 'node:crypto';
export async function originalStream(batch: string, kind: string) {
  const parts = await all<any>('SELECT * FROM raw_parts WHERE batch_id=? AND kind=? ORDER BY part',batch,kind);
  let index = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (index === parts.length) { controller.close(); return; }
        const part = parts[index++];
        const object = await bucket().get(part.key);
        const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
        if (bytes.length !== part.bytes || createHash('sha256').update(bytes).digest('hex') !== part.sha256)
          throw new Error('Archived original checksum mismatch; import stopped.');
        // Chunk to bound parser allocations even for huge source files.
        for (let offset=0;offset<bytes.length;offset+=65536) controller.enqueue(bytes.subarray(offset,offset+65536));
      } catch (error) { controller.error(error); }
    },
  });
}
export async function processImport(batch: string, progress: (text: string) => Promise<void>) {
  const state = await first<any>('SELECT status FROM batches WHERE id=?',batch);
  if (state?.status === 'complete') return { duplicate: true };
  await run("UPDATE batches SET status='processing',error=NULL WHERE id=?",batch);
  const map: Lookup = new Map();
  const lookupStream = await originalStream(batch,'lookup');
  for await (const row of readCSV({ stream: () => lookupStream })) map.set(`${row.ColumnName}|${row.ID}`,row.Description);
  const order = ['crash','unit','lookup','primaryperson','person','charges','damages','endorsements','restrictions'];
  for (const kind of order) {
    const file = await first<any>('SELECT * FROM files WHERE batch_id=? AND kind=?',batch,kind);
    if (file.parsed) continue;
    await progress(`Validating ${kind} · resuming from verified row chunks`);
    const stream = await originalStream(batch,kind);
    let rows: Record<string,unknown>[] = [], count = 0, number = 0;
    const send = async () => {
      if (!rows.length) return;
      await storeRows(batch,kind,{number:number++,rows});
      count += rows.length; rows = [];
      await progress(`Indexing ${kind} · ${count.toLocaleString('en-US')} rows verified`);
    };
    for await (const row of readCSV({ stream: () => stream })) {
      rows.push(normalize(row,kind,map));
      if (rows.length === 500) await send();
    }
    await send(); await finishFile(batch,kind,{rows:count});
  }
  await progress('Checking revisions and activating all nine files');
  return activate(batch);
}
