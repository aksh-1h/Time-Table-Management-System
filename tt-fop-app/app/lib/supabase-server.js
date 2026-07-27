import { createClient } from '@supabase/supabase-js';

/**
 * Server-side Supabase client (uses service role key for API routes).
 * Only use in API routes / server components — never expose to the browser.
 * Returns null if Supabase is not configured (no .env.local).
 */
export function createServerSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key || url.includes('YOUR_PROJECT')) {
    return null; // Supabase not configured — caller should use JSON fallback
  }

  return createClient(url, key);
}

/**
 * Check if Supabase is configured
 */
export function isSupabaseConfigured() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return !!(url && key && !url.includes('YOUR_PROJECT'));
}
