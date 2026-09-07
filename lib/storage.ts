import { createClient } from '@supabase/supabase-js';
let client: ReturnType<typeof createClient> | undefined;
function storage() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)
    throw new Error('Private Supabase storage is not configured.');
  client ??= createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client.storage.from(process.env.SUPABASE_STORAGE_BUCKET || 'txdot-originals');
}
export const bucket = () => ({
  async put(key: string, bytes: ArrayBuffer) {
    const { error } = await storage().upload(key, bytes, { contentType: 'application/octet-stream', upsert: false });
    // Immutable content-addressed keys make concurrent retries safe.
    if (error && !['409', '400'].includes(String((error as any).statusCode))) throw new Error('Original file storage failed.');
    if (error && !(await this.head(key))) throw new Error('Original file storage failed.');
  },
  async head(key: string) {
    const { data, error } = await storage().info(key);
    if (error) {
      if (['404', '400'].includes(String((error as any).statusCode))) return null;
      throw new Error('Could not verify original file storage.');
    }
    return data;
  },
  async get(key: string) {
    const { data, error } = await storage().createSignedUrl(key, 120);
    if (error || !data) throw new Error('Could not access private original file.');
    const response = await fetch(data.signedUrl, { signal: AbortSignal.timeout(60000) });
    if (!response.ok || !response.body) throw new Error('Could not read original file.');
    return { body: response.body };
  },
});
