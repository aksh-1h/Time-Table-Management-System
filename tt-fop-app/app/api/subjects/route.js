import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '../../lib/supabase-server';
import { parseFacultySubjectsData } from '../../lib/data-parser';

// GET /api/subjects — List all subjects with optional filters
export async function GET(request) {
  const supabase = createServerSupabaseClient();
  const { searchParams } = new URL(request.url);
  const program = searchParams.get('program');
  const semester = searchParams.get('semester');
  const classType = searchParams.get('classType');
  const specialization = searchParams.get('specialization');
  const withFaculty = searchParams.get('withFaculty') === 'true';

  // ── Supabase mode ──
  if (supabase) {
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
              name,
              designation
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

  // ── JSON fallback mode ──
  const { faculties, subjects, assignments } = parseFacultySubjectsData();
  
  let result = subjects;
  if (program) result = result.filter(s => s.program === program);
  if (semester) result = result.filter(s => s.semester === parseInt(semester));
  if (classType) result = result.filter(s => s.class_type === classType);
  if (specialization) result = result.filter(s => s.specialization === specialization);

  if (withFaculty) {
    result = result.map(s => {
      const subjAssignments = assignments
        .filter(a => a.subjectCode === s.subject_code && a.classType === s.class_type && a.program === s.program)
        .map(a => {
          const fac = faculties.find(f => f.name === a.facultyName);
          return {
            id: `asgn-${a.facultyName}-${s.subject_code}`,
            division: a.division,
            role: 'instructor',
            faculty: fac || null,
          };
        });
      return { ...s, faculty_subject_assignments: subjAssignments };
    });
  }

  result.sort((a, b) => {
    if (a.program !== b.program) return (a.program || '').localeCompare(b.program || '');
    if (a.semester !== b.semester) return (a.semester || 0) - (b.semester || 0);
    return (a.subject_code || '').localeCompare(b.subject_code || '');
  });

  return NextResponse.json(result);
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
