import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  try {
    const envPath = resolve(__dirname, '..', '.env.local');
    const envContent = readFileSync(envPath, 'utf-8');
    const vars = {};
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      vars[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
    }
    return vars;
  } catch (e) {
    console.error('Could not read .env.local');
    process.exit(1);
  }
}

const env = loadEnv();
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Supabase credentials missing.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function cleanup() {
  console.log('Cleaning up failed timetable_uploads records...');
  
  const { data: failedUploads, error: fetchErr } = await supabase
    .from('timetable_uploads')
    .select('id, file_path, original_filename')
    .eq('status', 'failed');

  if (fetchErr) {
    console.error('Error fetching failed uploads:', fetchErr.message);
    return;
  }

  console.log(`Found ${failedUploads.length} failed upload records in DB.`);

  if (failedUploads.length > 0) {
    const pathsToRemove = failedUploads.map(f => f.file_path).filter(Boolean);
    const idsToDelete = failedUploads.map(f => f.id);

    if (pathsToRemove.length > 0) {
      await supabase.storage.from('timetables').remove(pathsToRemove);
    }

    const { error: deleteErr } = await supabase
      .from('timetable_uploads')
      .delete()
      .in('id', idsToDelete);

    if (deleteErr) {
      console.error('Error deleting failed uploads:', deleteErr.message);
    } else {
      console.log(`Successfully deleted ${idsToDelete.length} failed upload records.`);
    }
  } else {
    console.log('No failed upload records to delete.');
  }
}

cleanup();
