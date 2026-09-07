/**
 * assignment-state.js
 * 
 * Shared ESM module for room assignment state.
 * 
 * BUG-4 FIX: Assignments are persisted to the `slot_assignments` table in Supabase.
 * The `slot_assignments` table is the single source of truth for room data.
 * GET /api/slots reads it directly on each request (no startup hydration needed).
 * 
 * The in-memory cache below is only used by:
 *   - POST /api/assign (occupancy tracking during a single algorithm run)
 *   - Offline / no-Supabase fallback in GET /api/slots
 * 
 * BUG-5 FIX: This replaces the broken require() cross-module pattern between
 * slots/route.js and assign/route.js. Both routes now import from this single
 * ESM module, eliminating the CommonJS/ESM mixing issue.
 */

import { createServerSupabaseClient } from './supabase-server';

// ── In-memory state (used by POST /api/assign and offline fallback only) ──
let _globalOccupancy = {};       // "day|roomNo" → [{ start, end, slotId, program, semester, division }]
let _globalAssignments = {};     // slotId → { roomNo, roomObj, manually }

// ── Public accessors ──

export function getGlobalAssignments() {
  return _globalAssignments;
}

export function getGlobalOccupancy() {
  return _globalOccupancy;
}

/**
 * Persist a batch of room assignments to the `slot_assignments` table.
 * Uses upsert (insert on conflict update) so re-running assignment is idempotent.
 * 
 * @param {Array} slots - Array of slot objects with room assignment results
 * @param {string} program
 * @param {number} semester 
 * @param {string} division
 */
export async function persistAssignmentsToDB(slots, program, semester, division) {
  const supabase = createServerSupabaseClient();
  if (!supabase) return;

  try {
    // Filter to only slots that have a room assignment
    const assignedSlots = slots.filter(s => 
      s.room_id && s.room_id !== null && 
      !s.is_recess && s.class_type !== 'recess'
    );

    if (assignedSlots.length === 0) return;

    // Look up room IDs from the rooms table
    const { data: dbRooms } = await supabase.from('rooms').select('id, room_no');
    const roomIdByNo = {};
    if (dbRooms) {
      for (const r of dbRooms) {
        roomIdByNo[r.room_no] = r.id;
        roomIdByNo[normRoom(r.room_no)] = r.id;
      }
    }

    // Build upsert rows
    const rows = [];
    for (const slot of assignedSlots) {
      const roomNo = slot.room?.room_no || (typeof slot.room === 'string' ? slot.room : null);
      if (!roomNo) continue;

      const dbRoomId = roomIdByNo[roomNo] || roomIdByNo[normRoom(roomNo)] || null;

      rows.push({
        program: program,
        division: division || 'ALL',
        batch: slot.batch || 'ALL',
        semester: Number(semester),
        day: slot.day,
        start_time: slot.start_time,
        end_time: slot.end_time,
        subject: slot.subject || '',
        faculty: slot.faculty || '',
        room_id: dbRoomId,
        manually_assigned: slot.manually_assigned || false,
      });
    }

    if (rows.length === 0) return;

    // Delete existing non-manual assignments for this scope, then insert fresh
    // This avoids conflicts and ensures clean state
    const { error: deleteError } = await supabase
      .from('slot_assignments')
      .delete()
      .eq('program', program)
      .eq('semester', Number(semester))
      .eq('division', division || 'ALL')
      .eq('manually_assigned', false);

    if (deleteError) {
      console.error('[assignment-state] Error clearing old assignments:', deleteError.message);
    }

    // Insert in batches of 100 to avoid payload limits
    const BATCH_SIZE = 100;
    let insertedCount = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const chunk = rows.slice(i, i + BATCH_SIZE);
      const { error: insertError } = await supabase
        .from('slot_assignments')
        .insert(chunk);

      if (insertError) {
        console.error(`[assignment-state] Insert error (batch ${i}):`, insertError.message);
      } else {
        insertedCount += chunk.length;
      }
    }

    console.log(`[assignment-state] Persisted ${insertedCount}/${rows.length} assignments to DB`);
  } catch (e) {
    console.error('[assignment-state] Persist error:', e.message);
  }
}

/**
 * Persist a single manual room assignment to the DB.
 * Used by the PATCH endpoint when an admin manually assigns a room.
 */
export async function persistSingleAssignment(slotData, roomObj, manually = false) {
  const supabase = createServerSupabaseClient();
  if (!supabase) return false;

  try {
    const { data: dbRooms } = await supabase
      .from('rooms')
      .select('id')
      .eq('room_no', roomObj.room_no)
      .limit(1);

    const dbRoomId = dbRooms?.[0]?.id || null;

    const row = {
      program: slotData.program || '',
      division: slotData.division || 'ALL',
      batch: slotData.batch || 'ALL',
      semester: Number(slotData.semester),
      day: slotData.day,
      start_time: slotData.start_time,
      end_time: slotData.end_time,
      subject: slotData.subject || '',
      faculty: slotData.faculty || '',
      room_id: dbRoomId,
      manually_assigned: manually,
    };

    // Upsert: delete existing for same slot, then insert.
    // BUG FIX: scope delete by program to prevent cross-program collisions
    // (migration 004 added the program column specifically for this reason).
    await supabase
      .from('slot_assignments')
      .delete()
      .eq('program', row.program)
      .eq('division', row.division)
      .eq('batch', row.batch)
      .eq('semester', row.semester)
      .eq('day', row.day)
      .eq('start_time', row.start_time)
      .eq('end_time', row.end_time)
      .eq('subject', row.subject);

    const { error } = await supabase
      .from('slot_assignments')
      .insert(row);

    if (error) {
      console.error('[assignment-state] Single persist error:', error.message);
      return false;
    }

    return true;
  } catch (e) {
    console.error('[assignment-state] Single persist error:', e.message);
    return false;
  }
}

/**
 * Remove a room assignment from the DB.
 */
export async function removeAssignmentFromDB(slotData) {
  const supabase = createServerSupabaseClient();
  if (!supabase) return;

  try {
    await supabase
      .from('slot_assignments')
      .delete()
      .eq('division', slotData.division || 'ALL')
      .eq('batch', slotData.batch || 'ALL')
      .eq('semester', Number(slotData.semester))
      .eq('day', slotData.day)
      .eq('start_time', slotData.start_time)
      .eq('end_time', slotData.end_time)
      .eq('subject', slotData.subject || '');
  } catch (e) {
    console.error('[assignment-state] Remove error:', e.message);
  }
}

// ── Occupancy helpers ──

export function isRoomFree(day, roomNo, start, end, excludeSlotId) {
  const key = `${day}|${normRoom(roomNo)}`;
  const occupants = _globalOccupancy[key] || [];
  return !occupants.some(
    o => o.slotId !== excludeSlotId && timesOverlap(start, end, o.start, o.end)
  );
}

export function markRoomOccupied(day, roomNo, start, end, slotId, program, semester, division) {
  const key = `${day}|${normRoom(roomNo)}`;
  if (!_globalOccupancy[key]) _globalOccupancy[key] = [];
  _globalOccupancy[key].push({ start, end, slotId, program, semester, division });
}

export function clearOccupancyForScope(programs, semesters, divisions) {
  for (const key of Object.keys(_globalOccupancy)) {
    _globalOccupancy[key] = _globalOccupancy[key].filter(o => {
      const inScope = programs.includes(o.program) &&
                      semesters.includes(o.semester) &&
                      (divisions.length === 0 || divisions.includes(o.division));
      if (inScope) {
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

export function setAssignment(slotId, roomNo, roomObj, manually = false) {
  _globalAssignments[slotId] = { roomNo, roomObj, manually };
}

export function removeAssignment(slotId) {
  delete _globalAssignments[slotId];
}

// ── Utility helpers (exported for use by assign/route.js and slots/route.js) ──

export function normRoom(no) {
  return no ? String(no).replace(/\s+/g, '').toUpperCase() : '';
}

export function timesOverlap(s1, e1, s2, e2) {
  return s1 < e2 && s2 < e1;
}

export function isGenericFaculty(name) {
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
