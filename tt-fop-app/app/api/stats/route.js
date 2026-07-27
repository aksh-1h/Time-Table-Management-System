import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '../../lib/supabase-server';
import { parseRoomsData, parseFacultySubjectsData } from '../../lib/data-parser';

/**
 * GET /api/stats — Aggregated dashboard statistics
 * Returns counts for rooms, faculties, subjects, assignments, slots, and NF-pending subjects.
 */
export async function GET() {
  const supabase = createServerSupabaseClient();

  try {
    // ── Supabase mode ──
    if (supabase) {
      const [
        roomsRes, facultiesRes, subjectsRes, assignmentsRes,
        slotsRes, slotAssignedRes, slotConflictsRes,
      ] = await Promise.all([
        supabase.from('rooms').select('id, category, program, is_active'),
        supabase.from('faculties').select('id').eq('is_active', true),
        supabase.from('subjects').select('id, program, class_type, specialization'),
        supabase.from('faculty_subject_assignments').select('id'),
        supabase.from('slot_assignments').select('id, room_id, manually_assigned'),
        supabase.from('slot_assignments').select('id').not('room_id', 'is', null),
        supabase.from('slot_assignments').select('id').is('room_id', null).eq('manually_assigned', false),
      ]);

      const rooms = roomsRes.data || [];
      const faculties = facultiesRes.data || [];
      const subjects = subjectsRes.data || [];
      const assignments = assignmentsRes.data || [];
      const allSlots = slotsRes.data || [];
      const assignedSlots = slotAssignedRes.data || [];
      const unassignedSlots = slotConflictsRes.data || [];

      return NextResponse.json(await computeStats(rooms, faculties, subjects, assignments, allSlots, assignedSlots, unassignedSlots, true, supabase));
    }

    // ── JSON fallback mode ──
    const rooms = parseRoomsData();
    const { faculties, subjects, assignments } = parseFacultySubjectsData();
    // No slots available in offline mode yet (they come from PDF uploads)
    return NextResponse.json(await computeStats(rooms, faculties, subjects, assignments, [], [], [], false));

  } catch (err) {
    console.error('[stats] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

async function computeStats(rooms, faculties, subjects, assignments, allSlots, assignedSlots, unassignedSlots, isSupabase, supabase) {
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
  if (isSupabase && supabase) {
    const subjectIdsWithFaculty = new Set();
    const { data: assignedSubjectIds } = await supabase.from('faculty_subject_assignments').select('subject_id');
    if (assignedSubjectIds) {
      for (const a of assignedSubjectIds) subjectIdsWithFaculty.add(a.subject_id);
    }
    nfPendingCount = subjects.filter(s => !subjectIdsWithFaculty.has(s.id)).length;
  } else {
    // In JSON mode, assignments list contains exactly the successful parsing
    // But our subjects list has unique subjects. Any subject not in assignments = NF pending.
    const assignedSubjKeys = new Set(assignments.map(a => `${a.subjectCode}|${a.classType}|${a.program}|${a.specialization || ''}`));
    nfPendingCount = subjects.filter(s => !assignedSubjKeys.has(`${s.subject_code}|${s.class_type}|${s.program}|${s.specialization || ''}`)).length;
  }

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
