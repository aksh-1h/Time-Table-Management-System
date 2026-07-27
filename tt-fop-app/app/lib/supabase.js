import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Browser client (uses anon key, respects RLS)
// Returns null if Supabase is not configured
export const supabase = (supabaseUrl && supabaseAnonKey && !supabaseUrl.includes('YOUR_PROJECT'))
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;
