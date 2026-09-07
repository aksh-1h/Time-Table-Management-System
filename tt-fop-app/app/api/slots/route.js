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

/**
 * Build a natural key for matching generated slots to persisted slot_assignments.
 * Generated slot IDs are ephemeral counters; slot_assignments IDs are Postgres UUIDs —
 * they are unrelated, so we match on the combination of fields that uniquely
 * identifies a class session.
 */
function slotKey(s) {
  return `${s.program}|${s.semester}|${s.division}|${s.batch || 'ALL'}|${s.day}|${s.start_time}|${s.end_time}|${s.subject}`;
}

export async function GET(request) {
  const supabase = createServerSupabaseClient();

  // ── Offline / no-Supabase fallback: use in-memory cache (unchanged behavior) ──
  if (!supabase) {
    return _getOffline(request);
  }

  const { searchParams } = new URL(request.url);
  const division = searchParams.get('division');
  const semester = searchParams.get('semester');
  const day = searchParams.get('day');
  const program = searchParams.get('program');
  const unassigned = searchParams.get('unassigned');

  let allSlots = [];

  try {
    // Fetch all active rooms for lookup
    const { data: dbRooms } = await supabase.from('rooms').select('*');
    const roomsByNo = {};
    const roomsById = {};
    if (dbRooms) {
      for (const r of dbRooms) {
        roomsByNo[r.room_no] = r;
        roomsByNo[normRoom(r.room_no)] = r;
        roomsById[r.id] = r;
      }
    }

    // ── Determine which program/semester/division combos have uploaded timetables ──
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

    // ── Load persisted slot_assignments for the entire scope in ONE query ──
    const dbAssignmentMap = {};
    if (uploadedCombos && uploadedCombos.length > 0) {
      // Build a scope filter: we need all assignments matching the uploaded combos
      // For simplicity and to honour the "one DB query" constraint, pull all
      // assignments matching programs+semesters in scope and filter in-memory.
      const scopePrograms = [...new Set(uploadedCombos.map(c => c.program))];
      const scopeSemesters = [...new Set(uploadedCombos.map(c => c.semester))];

      let saQuery = supabase
        .from('slot_assignments')
        .select('*')
        .in('program', scopePrograms)
        .in('semester', scopeSemesters);

      const { data: savedAssignments, error: saErr } = await saQuery;

      if (saErr) {
        console.error('[slots] Error loading slot_assignments:', saErr.message);
        // Non-fatal — we'll fall back to deterministic defaults below
      } else if (savedAssignments && savedAssignments.length > 0) {
        for (const sa of savedAssignments) {
          const key = slotKey(sa);
          // If multiple rows match the same key (shouldn't happen, but safety),
          // prefer the manually_assigned one.
          if (!dbAssignmentMap[key] || (sa.manually_assigned && !dbAssignmentMap[key].manually_assigned)) {
            dbAssignmentMap[key] = sa;
          }
        }
      }
    }

    // ── Generate slots and overlay room data ──
    if (uploadedCombos && uploadedCombos.length > 0) {
      for (const combo of uploadedCombos) {
        const prog = combo.program;
        const sem = combo.semester;
        const div = combo.division || 'ALL';

        const slots = await generateFullSchedule(prog, sem, div);
        const theoryRoomNo = getTheoryRoom(prog, sem, div, div);
        const labRoomNos = getLabRooms(prog, sem, div, div);

        for (const slot of slots) {
          // ── Priority 1: DB-persisted assignment (source of truth) ──
          const key = slotKey(slot);
          const dbSaved = dbAssignmentMap[key];

          if (dbSaved && dbSaved.room_id) {
            const roomObj = roomsById[dbSaved.room_id] || null;
            if (roomObj) {
              slot.room_id = roomObj.id;
              slot.room = roomObj;
              slot.manually_assigned = dbSaved.manually_assigned || false;
            } else {
              // room_id in slot_assignments points to a deleted/missing room —
              // treat as unassigned and let the deterministic fallback try
              _applyDeterministicRoom(slot, theoryRoomNo, labRoomNos, roomsByNo);
            }
          } else if (dbSaved && !dbSaved.room_id) {
            // Explicitly persisted as unassigned (e.g. room was removed)
            slot.room_id = null;
            slot.room = null;
            slot.manually_assigned = dbSaved.manually_assigned || false;
          } else {
            // ── Priority 2: No persisted assignment — deterministic default ──
            _applyDeterministicRoom(slot, theoryRoomNo, labRoomNos, roomsByNo);
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
  _detectFacultyConflicts(allSlots);

  // Filter slots based on query params
  if (program) allSlots = allSlots.filter(s => s.program === program);
  if (division) allSlots = allSlots.filter(s => s.division === division);
  if (semester) allSlots = allSlots.filter(s => s.semester === parseInt(semester));
  if (day) allSlots = allSlots.filter(s => s.day === day);
  if (unassigned === 'true') allSlots = allSlots.filter(s => !s.room_id && !s.is_recess && s.class_type !== 'self_study');

  return NextResponse.json(allSlots);
}

/**
 * Apply the deterministic default room from room-allocation-map.js.
 * This is the existing pre-fix behavior, extracted into a helper so the
 * DB-overlay path and the offline fallback can both use it.
 */
function _applyDeterministicRoom(slot, theoryRoomNo, labRoomNos, roomsByNo) {
  if (slot.class_type === 'theory' && theoryRoomNo) {
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
}

/**
 * Detect faculty double-bookings across all generated slots.
 * Mutates slot objects in-place by setting faculty_conflict / faculty_conflict_detail.
 */
function _detectFacultyConflicts(allSlots) {
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
}

/**
 * Offline fallback: original in-memory-cache behavior, used only when
 * createServerSupabaseClient() returns null.
 */
async function _getOffline(request) {
  const { searchParams } = new URL(request.url);
  const division = searchParams.get('division');
  const semester = searchParams.get('semester');
  const day = searchParams.get('day');
  const program = searchParams.get('program');
  const unassigned = searchParams.get('unassigned');

  const globalAssignments = getGlobalAssignments();
  let allSlots = [];

  try {
    // In offline mode we can't query timetable_uploads — generate for
    // whatever program/semester/division was requested if provided.
    if (program && semester) {
      const div = division || 'ALL';
      const slots = await generateFullSchedule(program, parseInt(semester), div);
      const theoryRoomNo = getTheoryRoom(program, parseInt(semester), div, div);
      const labRoomNos = getLabRooms(program, parseInt(semester), div, div);

      const roomsByNo = {}; // no DB in offline mode

      for (const slot of slots) {
        const saved = globalAssignments[slot.id];
        if (saved) {
          slot.room_id = saved.roomObj?.id || null;
          slot.room = saved.roomObj || null;
          slot.manually_assigned = saved.manually || false;
        } else {
          _applyDeterministicRoom(slot, theoryRoomNo, labRoomNos, roomsByNo);
        }
        allSlots.push(slot);
      }
    }
  } catch (e) {
    console.error('[slots] Error generating slots (offline):', e.message);
    return NextResponse.json([]);
  }

  _detectFacultyConflicts(allSlots);

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
