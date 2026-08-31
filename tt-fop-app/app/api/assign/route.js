import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '../../lib/supabase-server';
import { getTheoryRoom, getLabRooms, resolveSubjectLabRoom } from '../../lib/room-allocation-map';
import { generateFullSchedule } from '../../lib/workload-generator';
import {
  getGlobalAssignments,
  getGlobalOccupancy,
  isRoomFree,
  markRoomOccupied,
  clearOccupancyForScope,
  setAssignment,
  isGenericFaculty,
  persistAssignmentsToDB,
  normRoom,
  timesOverlap,
} from '../../lib/assignment-state';

const RECESS = { start: '12:30:00', end: '13:30:00' };

function isInRecess(start, end) {
  return start < RECESS.end && end > RECESS.start;
}

/**
 * POST /api/assign
 * Core Room Assignment API.
 * 
 * Rules:
 * 1. day, start_time, end_time, subject, faculty are IMMUTABLE.
 * 2. Manually locked slots (manually_assigned: true) are preserved and never changed.
 * 3. Independent Faculty Clash Detection Pass: Flags slots where the same faculty is double-booked.
 *    Faculty clash DOES NOT stop room assignment.
 * 4. Room Allocation Pass: Assigns room_id if an eligible room is free. If no room is available,
 *    leaves room_id = null and flags room_conflict = true with descriptive message.
 * 5. BUG-4 FIX: Results are persisted to the `slot_assignments` table for durability.
 */
export async function POST(request) {
  try {
    const supabase = createServerSupabaseClient();
    if (!supabase) {
      return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
    }

    const body = await request.json();
    const { scope } = body;

    if (!scope || !scope.programs || !scope.semesters) {
      return NextResponse.json({ error: 'scope.programs and scope.semesters are required' }, { status: 400 });
    }

    const { programs, semesters, divisions = [] } = scope;

    // Load all rooms from Supabase for lookup
    const { data: roomsData, error: roomsErr } = await supabase.from('rooms').select('*');
    if (roomsErr) throw roomsErr;

    const allRooms = roomsData || [];
    const roomsByNo = {};
    for (const r of allRooms) {
      roomsByNo[r.room_no] = r;
      roomsByNo[normRoom(r.room_no)] = r;
    }

    // Clear auto-assignments for scope while preserving manual locks
    clearOccupancyForScope(programs, semesters.map(Number), divisions);

    // ─────────────────────────────────────────────────────────────
    // STEP 1: Generate all slots for scope by finding uploaded schedules
    // ─────────────────────────────────────────────────────────────
    const allSlots = [];
    let query = supabase.from('timetable_uploads').select('program, semester, division');
    
    if (programs && programs.length > 0) query = query.in('program', programs);
    if (semesters && semesters.length > 0) query = query.in('semester', semesters.map(Number));
    if (divisions && divisions.length > 0) query = query.in('division', divisions);

    const { data: uploadedCombos, error: comboErr } = await query;
    if (comboErr) throw comboErr;

    if (uploadedCombos && uploadedCombos.length > 0) {
      for (const combo of uploadedCombos) {
        const slots = await generateFullSchedule(combo.program, combo.semester, combo.division || 'ALL');
        if (slots && slots.length > 0) {
          allSlots.push(...slots);
        }
      }
    }

    // ─────────────────────────────────────────────────────────────
    // STEP 2: Independent Faculty Clash Detection Pass
    // ─────────────────────────────────────────────────────────────
    const slotsByFacultyDay = {};

    for (const slot of allSlots) {
      if (slot.is_recess || slot.class_type === 'recess' || slot.class_type === 'self_study') continue;
      if (slot.faculty && !isGenericFaculty(slot.faculty)) {
        const key = `${slot.day}|${slot.faculty.trim()}`;
        if (!slotsByFacultyDay[key]) slotsByFacultyDay[key] = [];
        slotsByFacultyDay[key].push(slot);
      }
    }

    let facultyConflictCount = 0;
    for (const key of Object.keys(slotsByFacultyDay)) {
      const group = slotsByFacultyDay[key];
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const s1 = group[i];
          const s2 = group[j];
          if (timesOverlap(s1.start_time, s1.end_time, s2.start_time, s2.end_time)) {
            s1.faculty_conflict = true;
            s1.faculty_conflict_detail = `Faculty ${s1.faculty} is double-booked with ${s2.subject} (${s2.program} Sem ${s2.semester} Div ${s2.division} ${s2.batch !== 'ALL' ? `Batch ${s2.batch}` : ''}) at ${s1.start_time}–${s1.end_time}`;
            
            s2.faculty_conflict = true;
            s2.faculty_conflict_detail = `Faculty ${s2.faculty} is double-booked with ${s1.subject} (${s1.program} Sem ${s1.semester} Div ${s1.division} ${s1.batch !== 'ALL' ? `Batch ${s1.batch}` : ''}) at ${s2.start_time}–${s2.end_time}`;
            
            facultyConflictCount++;
          }
        }
      }
    }

    // ─────────────────────────────────────────────────────────────
    // STEP 3: Room Assignment Pass
    // ─────────────────────────────────────────────────────────────
    const stats = {
      totalSlots: 0,
      assigned: 0,
      locked: 0,
      roomConflicts: 0,
      facultyConflicts: facultyConflictCount,
      skippedRecess: 0,
      batchResults: [],
    };

    const globalAssignments = getGlobalAssignments();

    // Index generated slots by batch
    const batchMap = {};
    for (const slot of allSlots) {
      const key = `${slot.program}|${slot.semester}|${slot.division}`;
      if (!batchMap[key]) batchMap[key] = [];
      batchMap[key].push(slot);
    }

    for (const [batchKey, slots] of Object.entries(batchMap)) {
      const [prog, semStr, div] = batchKey.split('|');
      const semNum = Number(semStr);

      const batchResult = {
        program: prog,
        semester: semNum,
        division: div,
        total: 0,
        assigned: 0,
        locked: 0,
        roomConflicts: 0,
        facultyConflicts: 0,
      };

      const theoryRoomNo = getTheoryRoom(prog, semNum, div, div);
      const labRoomNos = getLabRooms(prog, semNum, div, div);

      for (const slot of slots) {
        if (slot.faculty_conflict) {
          batchResult.facultyConflicts++;
        }

        if (slot.is_recess || slot.class_type === 'recess') {
          stats.skippedRecess++;
          continue;
        }

        if (slot.class_type === 'self_study') {
          continue;
        }

        stats.totalSlots++;
        batchResult.total++;

        if (isInRecess(slot.start_time, slot.end_time)) {
          stats.skippedRecess++;
          continue;
        }

        // Check if slot was manually locked in memory
        const existing = globalAssignments[slot.id];
        if (existing && existing.manually && existing.roomObj) {
          slot.room_id = existing.roomObj.id;
          slot.room = existing.roomObj;
          slot.manually_assigned = true;
          markRoomOccupied(slot.day, existing.roomNo, slot.start_time, slot.end_time, slot.id, prog, semNum, div);
          stats.assigned++;
          stats.locked++;
          batchResult.assigned++;
          batchResult.locked++;
          continue;
        }

        // Determine candidate primary room
        let targetRoomNo = null;
        if (slot.room && typeof slot.room === 'string' && slot.room.trim().length > 0 && slot.room !== 'null') {
          targetRoomNo = slot.room.trim();
        } else if (slot.parsed_room && typeof slot.parsed_room === 'string' && slot.parsed_room.trim().length > 0) {
          targetRoomNo = slot.parsed_room.trim();
        } else if (slot.is_special || (slot.subject && slot.subject.includes('Practice School')) || slot.subject_code === 'BP706PS') {
          targetRoomNo = '368';
        } else if (slot.class_type === 'theory') {
          targetRoomNo = theoryRoomNo;
        } else if (slot.class_type === 'practical') {
          targetRoomNo = resolveSubjectLabRoom(slot.subject, labRoomNos);
        }

        // Candidate room availability check
        let assignedRoomNo = null;
        if (targetRoomNo && isRoomFree(slot.day, targetRoomNo, slot.start_time, slot.end_time, slot.id)) {
          assignedRoomNo = targetRoomNo;
        } else {
          // Fallback search within appropriate category pool
          if (slot.class_type === 'practical') {
            for (const altRoom of labRoomNos) {
              if (altRoom !== targetRoomNo && isRoomFree(slot.day, altRoom, slot.start_time, slot.end_time, slot.id)) {
                assignedRoomNo = altRoom;
                break;
              }
            }
            if (!assignedRoomNo) {
              const freeLab = allRooms.find(r => 
                r.is_active && 
                (r.category.includes('_lab') || r.category === 'lab') &&
                isRoomFree(slot.day, r.room_no, slot.start_time, slot.end_time, slot.id)
              );
              if (freeLab) assignedRoomNo = freeLab.room_no;
            }
          } else if (slot.class_type === 'theory') {
            const freeClassroom = allRooms.find(r =>
              r.is_active &&
              (r.category === 'classroom' || r.category === 'general') &&
              isRoomFree(slot.day, r.room_no, slot.start_time, slot.end_time, slot.id)
            );
            if (freeClassroom) assignedRoomNo = freeClassroom.room_no;
          }
        }

        if (assignedRoomNo) {
          const roomObj = roomsByNo[assignedRoomNo] || {
            id: `room-${assignedRoomNo}`,
            room_no: assignedRoomNo,
            room_name: assignedRoomNo === '368' ? 'PSH (Practice School Hall - 368)' : `Room ${assignedRoomNo}`,
            category: slot.class_type === 'practical' ? 'lab' : 'classroom',
            capacity: 60,
          };

          slot.room_id = roomObj.id;
          slot.room = roomObj;
          slot.manually_assigned = false;

          markRoomOccupied(slot.day, assignedRoomNo, slot.start_time, slot.end_time, slot.id, prog, semNum, div);
          setAssignment(slot.id, assignedRoomNo, roomObj, false);

          stats.assigned++;
          batchResult.assigned++;
        } else {
          slot.room_id = null;
          slot.room = null;
          slot.room_conflict = true;
          slot.room_conflict_detail = `Room shortage: No available ${slot.class_type === 'practical' ? 'lab' : 'classroom'} at ${slot.day} ${slot.start_time.slice(0,5)}–${slot.end_time.slice(0,5)}. Physical constraint for department review.`;
          
          stats.roomConflicts++;
          batchResult.roomConflicts++;
        }
      }

      stats.batchResults.push(batchResult);

      // BUG-4 FIX: Persist this batch's assignments to the DB
      await persistAssignmentsToDB(slots, prog, semNum, div);
    }

    return NextResponse.json({
      success: true,
      mode: 'full',
      stats,
      slots: allSlots,
    });

  } catch (err) {
    console.error('[assign] Error:', err);
    return NextResponse.json({ error: err.message, stack: err.stack }, { status: 500 });
  }
}

/**
 * GET /api/assign — Returns current global assignment state
 */
export async function GET() {
  return NextResponse.json({
    assignments: getGlobalAssignments(),
    occupancyKeys: Object.keys(getGlobalOccupancy()).length,
  });
}
