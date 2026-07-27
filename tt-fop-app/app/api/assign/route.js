import { NextResponse } from 'next/server';
import { parseRoomsData, parseFacultySubjectsData } from '../../lib/data-parser';
import { getTheoryRoom, getLabRooms } from '../../lib/room-allocation-map';
import { generateFullSchedule } from '../../lib/workload-generator';

/**
 * In-memory global occupancy store.
 * Key format: "day|roomNo" → [{ start, end, slotId, program, semester, division }]
 * 
 * Single source of truth for current assignments.
 */
let _globalOccupancy = {};
let _globalAssignments = {};  // slotId → { roomNo, roomObj, manually }

export function getGlobalAssignments() {
  return _globalAssignments;
}

export function getGlobalOccupancy() {
  return _globalOccupancy;
}

const RECESS = { start: '12:30:00', end: '13:30:00' };

function timesOverlap(s1, e1, s2, e2) {
  return s1 < e2 && s2 < e1;
}

function isInRecess(start, end) {
  return start < RECESS.end && end > RECESS.start;
}

function normRoom(no) {
  return no ? String(no).replace(/\s+/g, '').toUpperCase() : '';
}

function isRoomFree(day, roomNo, start, end, excludeSlotId) {
  const key = `${day}|${normRoom(roomNo)}`;
  const occupants = _globalOccupancy[key] || [];
  return !occupants.some(
    o => o.slotId !== excludeSlotId && timesOverlap(start, end, o.start, o.end)
  );
}

function markRoomOccupied(day, roomNo, start, end, slotId, program, semester, division) {
  const key = `${day}|${normRoom(roomNo)}`;
  if (!_globalOccupancy[key]) _globalOccupancy[key] = [];
  _globalOccupancy[key].push({ start, end, slotId, program, semester, division });
}

function clearOccupancyForScope(programs, semesters, divisions) {
  for (const key of Object.keys(_globalOccupancy)) {
    _globalOccupancy[key] = _globalOccupancy[key].filter(o => {
      const inScope = programs.includes(o.program) &&
                      semesters.includes(o.semester) &&
                      (divisions.length === 0 || divisions.includes(o.division));
      if (inScope) {
        // PRESERVE MANUALLY LOCKED SLOTS
        const assignment = _globalAssignments[o.slotId];
        if (assignment && assignment.manually) {
          return true; // keep manual lock in occupancy
        }
        delete _globalAssignments[o.slotId];
      }
      return !inScope;
    });
    if (_globalOccupancy[key].length === 0) delete _globalOccupancy[key];
  }
}

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
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { scope } = body;

    if (!scope || !scope.programs || !scope.semesters) {
      return NextResponse.json({ error: 'scope.programs and scope.semesters are required' }, { status: 400 });
    }

    const { programs, semesters, divisions = [] } = scope;

    // Load all rooms for lookup
    const allRooms = parseRoomsData();
    const roomsByNo = {};
    for (const r of allRooms) {
      roomsByNo[r.room_no] = r;
      roomsByNo[normRoom(r.room_no)] = r;
    }

    // Load faculty/subject data
    const { assignments: facultyAssignments } = parseFacultySubjectsData();

    // Clear auto-assignments for scope while preserving manual locks
    clearOccupancyForScope(programs, semesters.map(Number), divisions);

    // ─────────────────────────────────────────────────────────────
    // STEP 1: Generate all slots for scope by finding uploaded schedules
    // ─────────────────────────────────────────────────────────────
    const allSlots = [];
    const supabase = require('../../lib/supabase-server').createServerSupabaseClient();
    let query = supabase.from('timetable_uploads').select('program, semester, division');
    
    if (programs && programs.length > 0) query = query.in('program', programs);
    if (semesters && semesters.length > 0) query = query.in('semester', semesters.map(Number));
    if (divisions && divisions.length > 0) query = query.in('division', divisions);

    const { data: uploadedCombos, error: comboErr } = await query;
    if (comboErr) throw comboErr;

    if (uploadedCombos && uploadedCombos.length > 0) {
      for (const combo of uploadedCombos) {
        const slots = await generateFullSchedule(combo.program, combo.semester, combo.division || 'ALL', facultyAssignments);
        if (slots && slots.length > 0) {
          allSlots.push(...slots);
        }
      }
    }

    // ─────────────────────────────────────────────────────────────
    // STEP 2: Independent Faculty Clash Detection Pass
    // Group all non-recess/non-self-study slots by day & faculty
    // ─────────────────────────────────────────────────────────────
    const slotsByFacultyDay = {}; // `${day}|${faculty}` → [slots]

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
    // STEP 3: Room Assignment Pass (Operates purely on room_id)
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
      let labIdx = 0;

      for (const slot of slots) {
        // Count faculty conflicts per batch
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
        const existing = _globalAssignments[slot.id];
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
        } else if (slot.is_special || slot.subject.includes('Practice School') || slot.subject_code === 'BP706PS') {
          targetRoomNo = '368'; // Practice School Hall
        } else if (slot.class_type === 'theory') {
          targetRoomNo = theoryRoomNo;
        } else if (slot.class_type === 'practical') {
          if (labRoomNos.length > 0) {
            targetRoomNo = labRoomNos[labIdx % labRoomNos.length];
            labIdx++;
          }
        }

        // Candidate room availability check
        let assignedRoomNo = null;
        if (targetRoomNo && isRoomFree(slot.day, targetRoomNo, slot.start_time, slot.end_time, slot.id)) {
          assignedRoomNo = targetRoomNo;
        } else {
          // Fallback search within appropriate category pool
          if (slot.class_type === 'practical') {
            // First check other lab rooms in the allocated pool for this division
            for (const altRoom of labRoomNos) {
              if (altRoom !== targetRoomNo && isRoomFree(slot.day, altRoom, slot.start_time, slot.end_time, slot.id)) {
                assignedRoomNo = altRoom;
                break;
              }
            }
            // Secondary fallback: search all active lab rooms in the department
            if (!assignedRoomNo) {
              const freeLab = allRooms.find(r => 
                r.is_active && 
                (r.category.includes('_lab') || r.category === 'lab') &&
                isRoomFree(slot.day, r.room_no, slot.start_time, slot.end_time, slot.id)
              );
              if (freeLab) assignedRoomNo = freeLab.room_no;
            }
          } else if (slot.class_type === 'theory') {
            // Fallback for theory: search active classrooms in department
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
          _globalAssignments[slot.id] = { roomNo: assignedRoomNo, roomObj, manually: false };

          stats.assigned++;
          batchResult.assigned++;
        } else {
          // Physical Room Shortage: Leave room_id = null, surface conflict reason
          slot.room_id = null;
          slot.room = null;
          slot.room_conflict = true;
          slot.room_conflict_detail = `Room shortage: No available ${slot.class_type === 'practical' ? 'lab' : 'classroom'} at ${slot.day} ${slot.start_time.slice(0,5)}–${slot.end_time.slice(0,5)}. Physical constraint for department review.`;
          
          stats.roomConflicts++;
          batchResult.roomConflicts++;
        }
      }

      stats.batchResults.push(batchResult);
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
    assignments: _globalAssignments,
    occupancyKeys: Object.keys(_globalOccupancy).length,
  });
}

