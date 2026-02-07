import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/** Ensure the treasury-files bucket exists. Call once on app startup. */
export async function ensureStorageBuckets() {
  const buckets = [
    { id: 'treasury-files', public: false },
    { id: 'ai-images', public: true },
  ];
  for (const b of buckets) {
    const { error } = await supabase.storage.createBucket(b.id, {
      public: b.public,
      fileSizeLimit: 52428800, // 50MB
    });
    // Ignore "already exists" errors
    if (error && !error.message?.includes('already exists')) {
      console.warn(`Bucket "${b.id}":`, error.message);
    }
  }
}
