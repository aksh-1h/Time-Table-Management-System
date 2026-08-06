import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '../../lib/supabase-server';
import { generateFullSchedule } from '../../lib/workload-generator';
import { getTheoryRoom, getLabRooms } from '../../lib/room-allocation-map';

/**
 * Shared in-memory room assignments store.
 * Key: slotId → { id, room_no, room_name, category, capacity, manually }
 */
const _offlineRoomAssignments = {};

function isGenericFaculty(name) {
  if (!name) return true;
  const n = name.trim().toLowerCase();
  return (
    n === '' ||
    n === 'nf' ||
    n === 'new faculty' ||
    n === 'pending faculty' ||
    n === 'pending nf' ||
    n === 'faculty coordinator' ||
    n === 'tbd' ||
    n === 'na' ||
    n === '-' ||
    n === 'assignment/library' ||
    n === 'vac/swayam/nptel'
  );
}

function timesOverlap(s1, e1, s2, e2) {
  return s1 < e2 && s2 < e1;
}

/** Import from assign API global state */
function syncFromAssignApi() {
  try {
    const { getGlobalAssignments } = require('../assign/route');
    const globalAssignments = getGlobalAssignments();
    if (globalAssignments && Object.keys(globalAssignments).length > 0) {
      for (const [slotId, assignment] of Object.entries(globalAssignments)) {
        _offlineRoomAssignments[slotId] = {
          ...assignment.roomObj,
          manually: assignment.manually || false,
        };
      }
    }
  } catch (e) {
    // assign API not loaded yet
  }
}

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

  // ── Always use the timetable_uploads → generateFullSchedule path ──
  syncFromAssignApi();

  let allSlots = [];

  try {
    let query = supabase.from('timetable_uploads').select('program, semester, division');
    if (program) query = query.eq('program', program);
    if (semester) query = query.eq('semester', parseInt(semester));
    // For division filtering on timetable_uploads:
    // - B.Pharm stores division as 'A' or 'B'
    // - M.Pharm stores division as specialization name (e.g., 'Pharmaceutics')
    // - Pharm D stores division as null
    // We need to fetch ALL uploads for the program+semester and let generateFullSchedule handle it
    // Only filter by division for B.Pharm
    if (division && program === 'B.Pharm') {
      query = query.eq('division', division);
    } else if (division && program === 'M.Pharm') {
      // M.Pharm: the division param from UI is the specialization name
      query = query.eq('division', division);
    }
    // For Pharm D, don't filter by division — it's stored as null

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
          const saved = _offlineRoomAssignments[slot.id];
          if (saved) {
            slot.room_id = saved.id || null;
            slot.room = saved;
            slot.manually_assigned = saved.manually || false;
          } else if (slot.class_type === 'theory' && theoryRoomNo) {
            const rNo = slot.is_special || (slot.subject && slot.subject.includes('Practice School')) || slot.subject_code === 'BP706PS' ? '368' : theoryRoomNo;
            slot.room_id = `room-${rNo}`;
            slot.room = {
              id: `room-${rNo}`,
              room_no: rNo,
              room_name: rNo === '368' ? 'PSH (Practice School Hall - 368)' : `Room ${rNo}`,
              category: 'classroom',
              capacity: 60,
            };
          } else if (slot.class_type === 'practical' && labRoomNos.length > 0) {
            // Lab rooms are predefined — assign based on the slot's batch
            // Use the room that was defined in the uploaded timetable if available
            if (slot.room && typeof slot.room === 'string' && slot.room.trim().length > 0 && slot.room !== 'null') {
              const rNo = slot.room.trim();
              slot.room_id = `room-${rNo}`;
              slot.room = {
                id: `room-${rNo}`,
                room_no: rNo,
                room_name: `Lab ${rNo}`,
                category: 'lab',
                capacity: 30,
              };
            } else {
              // Fallback: use predefined lab room pool from room-allocation-map
              // Each batch gets a specific lab from the predefined pool
              const batchLabIndex = getBatchLabIndex(slot.batch, labRoomNos);
              const rNo = labRoomNos[batchLabIndex % labRoomNos.length];
              slot.room_id = `room-${rNo}`;
              slot.room = {
                id: `room-${rNo}`,
                room_no: rNo,
                room_name: `Lab ${rNo}`,
                category: 'lab',
                capacity: 30,
              };
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

/**
 * Get a consistent lab room index for a batch.
 * Batches A, B, C, D map to lab pool indices 0, 1, 2, 3 respectively.
 * For non-B.Pharm batches, defaults to 0.
 */
function getBatchLabIndex(batch, labRoomNos) {
  if (!batch || batch === 'ALL') return 0;
  const batchIndex = { 'A': 0, 'B': 1, 'C': 2, 'D': 3 };
  return (batchIndex[batch] || 0) % labRoomNos.length;
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
        if (!updateErr && updated) return NextResponse.json(updated);
      }
    } catch (e) {
      // Fallback to in-memory store
    }
  }

  // Offline mode — store in shared memory & assign route global state
  if (room_id && room) {
    _offlineRoomAssignments[id] = { ...room, manually: !!manually_assigned };
    try {
      const { getGlobalAssignments } = require('../assign/route');
      const gAss = getGlobalAssignments();
      gAss[id] = { roomNo: room.room_no, roomObj: room, manually: !!manually_assigned };
    } catch (e) {}
  } else if (room_id === null) {
    delete _offlineRoomAssignments[id];
    try {
      const { getGlobalAssignments } = require('../assign/route');
      const gAss = getGlobalAssignments();
      delete gAss[id];
    } catch (e) {}
  }
  return NextResponse.json({ id, room_id: room_id ?? null, room: room_id && room ? room : null, manually_assigned: !!manually_assigned, _offline: true });
}
