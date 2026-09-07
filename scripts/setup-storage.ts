import { createClient } from '@supabase/supabase-js';
if(!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)throw new Error('Set Supabase URL and server-side service key.');
const storage=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}}).storage;
const name=process.env.SUPABASE_STORAGE_BUCKET || 'txdot-originals';
const {data,error}=await storage.getBucket(name);
if(data){if(data.public)throw new Error('The configured bucket is PUBLIC. Choose a new private bucket; no data was changed.');console.log('Private originals bucket verified.');}
else{
 if(error && !['400','404'].includes(String((error as any).statusCode)))throw new Error('Could not verify storage bucket. Check project permissions.');
 const created=await storage.createBucket(name,{public:false,fileSizeLimit:10*1024*1024,allowedMimeTypes:['application/octet-stream']});
 if(created.error)throw new Error('Could not create private originals bucket. Check project permissions.');
 console.log('Private originals bucket created. No anonymous storage policies were added.');
}
