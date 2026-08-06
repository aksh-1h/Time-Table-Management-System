import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '../../lib/supabase-server';

/**
 * GET /api/schedules?program=B.Pharm&semester=1&division=B
 * Load a stored schedule definition from DB.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const program = searchParams.get('program');
  const semester = searchParams.get('semester');
  const division = searchParams.get('division');

  if (!program || !semester) {
    return NextResponse.json({ error: 'program and semester are required' }, { status: 400 });
  }

  const supabase = createServerSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  try {
    let query = supabase.from('timetable_uploads')
      .select('id, program, semester, division')
      .eq('program', program)
      .eq('semester', semester);
      
    if (division && division !== 'ALL' && division !== 'null') {
      query = query.eq('division', division);
    } else {
      // For programs where division is stored as null (e.g., Pharm D)
      query = query.is('division', null);
    }

    const { data: uploads, error: uploadsError } = await query;

    if (uploadsError) throw uploadsError;

    if (!uploads || uploads.length === 0) {
      return NextResponse.json({ 
        exists: false, 
        message: `No schedule uploaded for ${program} Sem ${semester} Div ${division || 'ALL'}`
      }, { status: 404 });
    }

    const uploadId = uploads[0].id;

    const { data: entries, error: entriesError } = await supabase
      .from('timetable_entries')
      .select('*')
      .eq('upload_id', uploadId);

    if (entriesError) throw entriesError;

    // Transform DB entries back to expected slots format for generator
    const slots = entries.map(e => ({
      day: e.day,
      period: e.period,
      start_time: e.start_time,
      end_time: e.end_time,
      subject: e.subject,
      code: e.subject_code,
      type: e.class_type,
      batch: e.batch,
      faculty: e.faculty,
      room: e.room
    }));

    return NextResponse.json({ exists: true, schedule: { slots }, key: uploadId });
  } catch (err) {
    return NextResponse.json({ error: `Failed to read schedule: ${err.message}` }, { status: 500 });
  }
}

/**
 * DELETE /api/schedules?id=UUID
 * Remove a stored schedule.
 */
export async function DELETE(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'upload ID is required' }, { status: 400 });
  }

  const supabase = createServerSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  try {
    // We should also delete the file from Storage bucket if possible
    const { data: upload } = await supabase.from('timetable_uploads').select('file_path').eq('id', id).single();
    if (upload && upload.file_path) {
      await supabase.storage.from('timetables').remove([upload.file_path]);
    }

    const { error } = await supabase.from('timetable_uploads').delete().eq('id', id);
    if (error) throw error;

    return NextResponse.json({ success: true, message: `Deleted schedule` });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
