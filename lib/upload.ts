import { identify } from './csv';
export type UploadProgress = { batch:string; file:string; stage:string; rows:number; percent:number };
export type APICall = (path:string,body?:unknown,raw?:Blob) => Promise<any>;
export async function uploadFiles(files:File[],api:APICall,onProgress:(p:UploadProgress)=>void,signal?:AbortSignal) {
  const groups = new Map<string,File[]>();
  for (const file of files) {
    if (!file.name.toLowerCase().endsWith('.csv')) continue;
    const { id } = identify(file.name); groups.set(id,[...(groups.get(id)||[]),file]);
  }
  if (!groups.size) throw new Error('Select original TxDOT CSV files. Unzip archives first.');
  for (const [id,group] of groups) if (group.length!==9 || new Set(group.map(f=>identify(f.name).kind)).size!==9)
    throw new Error(`${id}: select all nine matching files before uploading.`);
  const total = files.reduce((n,f)=>n+f.size,0); let sent = 0;
  const reports:any[] = [];
  const check = () => { if (signal?.aborted) throw new Error('Upload paused. Re-select the same files to resume safely.'); };
  for (const [batch,group] of groups) {
    check();
    const info = await api('imports',{files:group.map(f=>({name:f.name,bytes:f.size}))});
    if (info.status !== 'uploading') {
      reports.push({batch,status:info.status}); sent += group.reduce((n,f)=>n+f.size,0); continue;
    }
    const uploaded = await api(`imports/${batch}/parts`);
    for (const file of group) {
      const { kind } = identify(file.name); const size = 8*1024*1024;
      for (let offset=0;offset<file.size;offset+=size) {
        check();
        const blob = file.slice(offset,Math.min(offset+size,file.size));
        const prior = uploaded.find((p:any)=>p.kind===kind && p.part===offset/size);
        if (prior) {
          const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))).map(n=>n.toString(16).padStart(2,'0')).join('');
          if (digest !== prior.sha256) throw new Error('A selected file differs from the original upload.');
        } else {
          let attempt=0;
          while (true) {
            try { await api(`imports/${batch}/raw?kind=${kind}&part=${offset/size}`,undefined,blob); break; }
            catch(error) { if (++attempt>=3) throw error; check(); await new Promise(resolve=>setTimeout(resolve,attempt*1000)); }
          }
        }
        sent += blob.size;
        onProgress({batch,file:file.name,stage:'Uploading originals · keep this tab open',rows:0,percent:Math.round(sent/total*100)});
      }
    }
    const job = await api(`imports/${batch}/queue`,{}); reports.push({batch,jobId:job.id,status:job.status});
  }
  onProgress({batch:'',file:'',stage:'Files stored · processing continues in the background',rows:0,percent:100});
  return reports;
}
