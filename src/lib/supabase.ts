import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    '[supabase] VITE_SUPABASE_URL and/or VITE_SUPABASE_ANON_KEY are not set. ' +
    'Supabase features will be unavailable. Set these in your Vercel Environment Variables.'
  );
}

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-key',
);

/** Ensure the treasury-files bucket exists. Call once on app startup. */
export async function ensureStorageBuckets() {
  if (!supabaseUrl || !supabaseAnonKey) return; // skip if not configured
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
