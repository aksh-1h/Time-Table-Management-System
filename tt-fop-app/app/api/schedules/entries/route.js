import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '../../../lib/supabase-server';

/**
 * GET /api/schedules/entries?upload_id=UUID
 * Fetch all parsed entries for a specific upload.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const uploadId = searchParams.get('upload_id');

  if (!uploadId) {
    return NextResponse.json({ error: 'upload_id is required' }, { status: 400 });
  }

  const supabase = createServerSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  try {
    const { data: entries, error } = await supabase
      .from('timetable_entries')
      .select('*')
      .eq('upload_id', uploadId)
      .order('day', { ascending: true })
      .order('period', { ascending: true });

    if (error) throw error;

    return NextResponse.json({ entries: entries || [] });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * PUT /api/schedules/entries
 * Update one or more fields of a single parsed entry.
 * Body: { id: UUID, ...fieldsToUpdate }
 */
export async function PUT(request) {
  const supabase = createServerSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  try {
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json({ error: 'Entry id is required' }, { status: 400 });
    }

    // Whitelist allowed fields
    const allowedFields = [
      'day', 'period', 'start_time', 'end_time',
      'subject', 'subject_code', 'class_type',
      'batch', 'faculty', 'room', 'parsing_score'
    ];

    const sanitized = {};
    for (const key of allowedFields) {
      if (key in updates) {
        sanitized[key] = updates[key];
      }
    }

    if (Object.keys(sanitized).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('timetable_entries')
      .update(sanitized)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, entry: data });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * DELETE /api/schedules/entries?id=UUID
 * Delete a single parsed entry.
 */
export async function DELETE(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'Entry id is required' }, { status: 400 });
  }

  const supabase = createServerSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  try {
    const { error } = await supabase
      .from('timetable_entries')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
