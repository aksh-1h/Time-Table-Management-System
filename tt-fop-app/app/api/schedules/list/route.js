import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '../../../lib/supabase-server';

/**
 * GET /api/schedules/list
 * Returns a list of all saved schedule definitions from DB.
 */
export async function GET() {
  const supabase = createServerSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ schedules: [] });
  }

  try {
    const { data: uploads, error } = await supabase
      .from('timetable_uploads')
      .select(`
        id, file_path, original_filename, program, semester, division, status, uploaded_at, overall_parsing_score,
        timetable_entries (count)
      `)
      .neq('status', 'failed')
      .order('uploaded_at', { ascending: false });

    if (error) throw error;

    const schedules = uploads.map(u => ({
      key: u.id,
      id: u.id,
      program: u.program,
      semester: u.semester,
      division: u.division,
      slotsCount: u.timetable_entries?.[0]?.count || 0,
      updatedAt: u.uploaded_at,
      status: u.status,
      original_filename: u.original_filename,
      overallParsingScore: u.overall_parsing_score || 0
    }));

    return NextResponse.json({ schedules });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
