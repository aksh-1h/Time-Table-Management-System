import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '../../lib/supabase-server';

// GET /api/subjects — List all subjects with optional filters
export async function GET(request) {
  const supabase = createServerSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const program = searchParams.get('program');
  const semester = searchParams.get('semester');
  const classType = searchParams.get('classType');
  const specialization = searchParams.get('specialization');
  const withFaculty = searchParams.get('withFaculty') === 'true';

  let query;

  if (withFaculty) {
    query = supabase
      .from('subjects')
      .select(`
        *,
        faculty_subject_assignments (
          id,
          division,
          role,
          faculty:faculty_id (
            id,
            name
          )
        )
      `);
  } else {
    query = supabase.from('subjects').select('*');
  }

  if (program) query = query.eq('program', program);
  if (semester) query = query.eq('semester', parseInt(semester));
  if (classType) query = query.eq('class_type', classType);
  if (specialization) query = query.eq('specialization', specialization);

  query = query.order('program').order('semester').order('subject_code');

  const { data, error } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// POST /api/subjects — Add a new subject (Supabase only)
export async function POST(request) {
  const supabase = createServerSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const body = await request.json();
  const { subject_code, subject_name, program, specialization, semester, class_type } = body;

  if (!subject_code || !subject_name || !program) {
    return NextResponse.json(
      { error: 'subject_code, subject_name, and program are required' },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from('subjects')
    .insert({
      subject_code,
      subject_name,
      program,
      specialization: specialization || null,
      semester: semester || null,
      class_type: class_type || 'theory',
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

// DELETE /api/subjects?id=... — Delete a subject (Supabase only)
export async function DELETE(request) {
  const supabase = createServerSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) return NextResponse.json({ error: 'id parameter required' }, { status: 400 });

  const { error } = await supabase.from('subjects').delete().eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
