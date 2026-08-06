import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '../../lib/supabase-server';

// GET /api/faculties — List all faculties, optionally with their subject assignments
export async function GET(request) {
  const supabase = createServerSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const withSubjects = searchParams.get('withSubjects') === 'true';

  if (withSubjects) {
    const { data, error } = await supabase
      .from('faculties')
      .select(`
        *,
        faculty_subject_assignments (
          id,
          division,
          role,
          academic_year,
          subjects:subject_id (
            id,
            subject_code,
            subject_name,
            program,
            specialization,
            semester,
            class_type
          )
        )
      `)
      .eq('is_active', true)
      .order('name');

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }

  const { data, error } = await supabase
    .from('faculties')
    .select('*')
    .eq('is_active', true)
    .order('name');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// POST /api/faculties — Add a new faculty (Supabase only)
export async function POST(request) {
  const supabase = createServerSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Database not configured. Cannot add faculty in offline mode.' }, { status: 503 });
  }

  const body = await request.json();
  const { name } = body;

  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });

  const { data, error } = await supabase
    .from('faculties')
    .insert({ name })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

// DELETE /api/faculties?id=... — Soft-delete (Supabase only)
export async function DELETE(request) {
  const supabase = createServerSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id parameter required' }, { status: 400 });

  const { data, error } = await supabase
    .from('faculties')
    .update({ is_active: false })
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
