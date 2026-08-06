import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '../../lib/supabase-server';

/**
 * GET /api/stats — Aggregated dashboard statistics
 * Returns counts for rooms, faculties, subjects, assignments, slots, and NF-pending subjects.
 */
export async function GET() {
  const supabase = createServerSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }

  try {
    const [
      roomsRes, facultiesRes, subjectsRes, assignmentsRes,
      slotsRes, slotAssignedRes, slotConflictsRes,
    ] = await Promise.all([
      supabase.from('rooms').select('id, category, program, is_active'),
      supabase.from('faculties').select('id').eq('is_active', true),
      supabase.from('subjects').select('id, program, class_type, specialization'),
      supabase.from('faculty_subject_assignments').select('id'),
      supabase.from('timetable_entries').select('id, room'),
      supabase.from('timetable_entries').select('id').not('room', 'is', null).neq('room', ''),
      supabase.from('timetable_entries').select('id').or('room.is.null,room.eq.'),
    ]);

    const rooms = roomsRes.data || [];
    const faculties = facultiesRes.data || [];
    const subjects = subjectsRes.data || [];
    const assignments = assignmentsRes.data || [];
    const allSlots = slotsRes.data || [];
    const assignedSlots = slotAssignedRes.data || [];
    const unassignedSlots = slotConflictsRes.data || [];

    return NextResponse.json(await computeStats(rooms, faculties, subjects, assignments, allSlots, assignedSlots, unassignedSlots, supabase));

  } catch (err) {
    console.error('[stats] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

async function computeStats(rooms, faculties, subjects, assignments, allSlots, assignedSlots, unassignedSlots, supabase) {
  const roomsByCategory = {};
  let classroomCount = 0;
  let labCount = 0;
  for (const r of rooms) {
    roomsByCategory[r.category] = (roomsByCategory[r.category] || 0) + 1;
    if (r.category === 'classroom') classroomCount++;
    else if (r.category.includes('_lab') || r.category.includes('lab')) labCount++;
  }

  const subjectsByProgram = {};
  for (const s of subjects) {
    subjectsByProgram[s.program] = (subjectsByProgram[s.program] || 0) + 1;
  }

  let nfPendingCount = 0;
  const subjectIdsWithFaculty = new Set();
  const { data: assignedSubjectIds } = await supabase.from('faculty_subject_assignments').select('subject_id');
  if (assignedSubjectIds) {
    for (const a of assignedSubjectIds) subjectIdsWithFaculty.add(a.subject_id);
  }
  nfPendingCount = subjects.filter(s => !subjectIdsWithFaculty.has(s.id)).length;

  const totalSlots = allSlots.length;
  const assignedCount = assignedSlots.length;
  const manuallyLockedCount = allSlots.filter(s => s.manually_assigned).length;
  const unassignedCount = unassignedSlots.length;
  const assignedPercent = totalSlots > 0 ? Math.round((assignedCount / totalSlots) * 100) : 0;

  return {
    rooms: {
      total: rooms.length,
      active: rooms.filter(r => r.is_active).length,
      classrooms: classroomCount,
      labs: labCount,
      byCategory: roomsByCategory,
    },
    faculties: { total: faculties.length },
    subjects: { total: subjects.length, byProgram: subjectsByProgram, nfPending: nfPendingCount },
    assignments: { total: assignments.length },
    slots: { total: totalSlots, assigned: assignedCount, unassigned: unassignedCount, manuallyLocked: manuallyLockedCount, assignedPercent },
  };
}
