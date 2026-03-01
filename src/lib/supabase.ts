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

/** Ensure the treasury-files bucket exists. Call once on app startup.
 *  NOTE: Buckets are pre-created in Supabase. The anon key lacks permission
 *  to create them (RLS), so this is a no-op guard — silently skips. */
export async function ensureStorageBuckets() {
  // Buckets already exist server-side; anon key cannot create them.
  // Skip entirely to avoid 400 / RLS errors in the console.
}
