import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '../../lib/supabase-server';
import { generateFullSchedule } from '../../lib/workload-generator';
import { getTheoryRoom, getLabRooms, resolveSubjectLabRoom } from '../../lib/room-allocation-map';
import {
  getGlobalAssignments,
  isGenericFaculty,
  persistSingleAssignment,
  removeAssignmentFromDB,
  setAssignment,
  removeAssignment,
  normRoom,
  timesOverlap,
} from '../../lib/assignment-state';

export async function GET(request) {
  const supabase = createServerSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const division = searchParams.get('division');
  const semester = searchParams.get('semester');
  const day = searchParams.get('day');
  const program = searchParams.get('program');
  const unassigned = searchParams.get('unassigned');

  // BUG-5 FIX: Use shared ESM import instead of require()
  const globalAssignments = getGlobalAssignments();

  let allSlots = [];

  try {
    // Fetch all active rooms for DB lookup
    const { data: dbRooms } = await supabase.from('rooms').select('*');
    const roomsByNo = {};
    if (dbRooms) {
      for (const r of dbRooms) {
        roomsByNo[r.room_no] = r;
        roomsByNo[normRoom(r.room_no)] = r;
      }
    }

    let query = supabase.from('timetable_uploads').select('program, semester, division');
    if (program) query = query.eq('program', program);
    if (semester) query = query.eq('semester', parseInt(semester));
    if (division && program === 'B.Pharm') {
      query = query.eq('division', division);
    } else if (division && program === 'M.Pharm') {
      query = query.eq('division', division);
    }

    const { data: uploadedCombos, error: comboErr } = await query;

    if (comboErr) {
      console.error('[slots] Error querying timetable_uploads:', comboErr.message);
      return NextResponse.json([]);
    }

    if (uploadedCombos && uploadedCombos.length > 0) {
      for (const combo of uploadedCombos) {
        const prog = combo.program;
        const sem = combo.semester;
        const div = combo.division || 'ALL';

        const slots = await generateFullSchedule(prog, sem, div);
        const theoryRoomNo = getTheoryRoom(prog, sem, div, div);
        const labRoomNos = getLabRooms(prog, sem, div, div);

        for (const slot of slots) {
          // Check if this slot was manually assigned in memory
          const saved = globalAssignments[slot.id];
          if (saved) {
            slot.room_id = saved.roomObj?.id || null;
            slot.room = saved.roomObj || null;
            slot.manually_assigned = saved.manually || false;
          } else if (slot.class_type === 'theory' && theoryRoomNo) {
            const rNo = slot.is_special || (slot.subject && slot.subject.includes('Practice School')) || slot.subject_code === 'BP706PS' ? '368' : theoryRoomNo;
            const roomObj = roomsByNo[rNo] || roomsByNo[normRoom(rNo)] || {
              id: `room-${rNo}`,
              room_no: rNo,
              room_name: rNo === '368' ? 'PSH (Practice School Hall - 368)' : `Room ${rNo}`,
              category: 'classroom',
              capacity: 60,
            };
            slot.room_id = roomObj.id;
            slot.room = roomObj;
          } else if (slot.class_type === 'practical') {
            let rNo = null;
            if (slot.room && typeof slot.room === 'string' && slot.room.trim().length > 0 && slot.room !== 'null') {
              rNo = slot.room.trim();
            } else if (slot.parsed_room && typeof slot.parsed_room === 'string' && slot.parsed_room.trim().length > 0) {
              rNo = slot.parsed_room.trim();
            } else {
              rNo = resolveSubjectLabRoom(slot.subject, labRoomNos);
            }

            if (rNo) {
              const roomObj = roomsByNo[rNo] || roomsByNo[normRoom(rNo)] || {
                id: `room-${rNo}`,
                room_no: rNo,
                room_name: `Lab ${rNo}`,
                category: 'lab',
                capacity: 30,
              };
              slot.room_id = roomObj.id;
              slot.room = roomObj;
            }
          }
          allSlots.push(slot);
        }
      }
    }
  } catch (e) {
    console.error('[slots] Error generating slots:', e.message);
    return NextResponse.json([]);
  }

  // Detect Faculty Conflicts across all generated slots
  const slotsByFacultyDay = {};
  for (const slot of allSlots) {
    if (slot.is_recess || slot.class_type === 'recess' || slot.class_type === 'self_study') continue;
    if (slot.faculty && !isGenericFaculty(slot.faculty)) {
      const key = `${slot.day}|${slot.faculty.trim()}`;
      if (!slotsByFacultyDay[key]) slotsByFacultyDay[key] = [];
      slotsByFacultyDay[key].push(slot);
    }
  }

  for (const group of Object.values(slotsByFacultyDay)) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const s1 = group[i];
        const s2 = group[j];
        if (timesOverlap(s1.start_time, s1.end_time, s2.start_time, s2.end_time)) {
          s1.faculty_conflict = true;
          s1.faculty_conflict_detail = `Faculty ${s1.faculty} is double-booked with ${s2.subject} (${s2.program} Sem ${s2.semester} Div ${s2.division}) at ${s1.start_time}–${s1.end_time}`;
          s2.faculty_conflict = true;
          s2.faculty_conflict_detail = `Faculty ${s2.faculty} is double-booked with ${s1.subject} (${s1.program} Sem ${s1.semester} Div ${s1.division}) at ${s2.start_time}–${s2.end_time}`;
        }
      }
    }
  }

  // Filter slots based on query params
  if (program) allSlots = allSlots.filter(s => s.program === program);
  if (division) allSlots = allSlots.filter(s => s.division === division);
  if (semester) allSlots = allSlots.filter(s => s.semester === parseInt(semester));
  if (day) allSlots = allSlots.filter(s => s.day === day);
  if (unassigned === 'true') allSlots = allSlots.filter(s => !s.room_id && !s.is_recess && s.class_type !== 'self_study');

  return NextResponse.json(allSlots);
}

export async function PATCH(request) {
  const supabase = createServerSupabaseClient();
  const body = await request.json();
  const { id, room_id, room, manually_assigned } = body;
  if (!id) return NextResponse.json({ error: 'slot id is required' }, { status: 400 });

  if (supabase) {
    try {
      const { data: slot, error: slotErr } = await supabase.from('timetable_entries').select('*').eq('id', id).single();
      if (!slotErr && slot) {
        const roomVal = room ? (room.room_no || room) : (room_id ? String(room_id) : null);
        const { data: updated, error: updateErr } = await supabase.from('timetable_entries')
          .update({ room: roomVal }).eq('id', id).select().single();
        if (!updateErr && updated) {
          // BUG-4 FIX: Also persist to slot_assignments for durability
          if (room && room.room_no) {
            await persistSingleAssignment(
              { ...slot, division: slot.division || 'ALL' },
              room,
              !!manually_assigned
            );
          }
          return NextResponse.json(updated);
        }
      }
    } catch (e) {
      // Fallback to in-memory store
    }
  }

  // Offline mode — store in shared memory via assignment-state module
  if (room_id && room) {
    setAssignment(id, room.room_no, room, !!manually_assigned);
  } else if (room_id === null) {
    removeAssignment(id);
  }
  return NextResponse.json({ id, room_id: room_id ?? null, room: room_id && room ? room : null, manually_assigned: !!manually_assigned, _offline: true });
}
