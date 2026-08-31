/**
 * workload-generator.js
 * 
 * Schedule loader and slot builder for Faculty of Pharmacy (FOP).
 * 
 * ARCHITECTURE:
 * - Schedule data (subjects, times, days, faculty) comes from UPLOADED JSON files
 *   stored in the schedules/ directory. The system NEVER generates or modifies this data.
 * - This module reads stored schedules and converts them into slot objects for display
 *   and room assignment.
 * - The room assignment algorithm (in /api/assign) ONLY assigns room numbers.
 * 
 * SCHEDULE FORMAT (stored in schedules/):
 * - For practical slots, only ONE entry per batch per day at the starting period (e.g., period 3).
 *   The system auto-expands to 3 consecutive 1-hour slots (periods 3, 4, 5).
 * - For self_study/VAC slots, define each period explicitly.
 * 
 * B.Pharm: Div A → Batches [A, B], Div B → Batches [C, D]
 */

import { createServerSupabaseClient } from './supabase-server';

const PERIODS = [
  { start: '09:30:00', end: '10:30:00', label: '09:30 - 10:30' },
  { start: '10:30:00', end: '11:30:00', label: '10:30 - 11:30' },
  { start: '11:30:00', end: '12:30:00', label: '11:30 - 12:30' },
  { start: '13:30:00', end: '14:30:00', label: '13:30 - 14:30' },
  { start: '14:30:00', end: '15:30:00', label: '14:30 - 15:30' },
  { start: '15:30:00', end: '16:25:00', label: '15:30 - 16:25' },
];

const RECESS = { start: '12:30:00', end: '13:30:00', label: '12:30 - 13:30' };
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Get divisions & batch names for a program and division letter
 */
export function getBatchesForDivision(program, division) {
  if (program === 'B.Pharm') {
    if (division === 'A') return ['A', 'B'];
    if (division === 'B') return ['C', 'D'];
    return ['A', 'B'];
  }
  return [division || 'ALL'];
}

/**
 * Load a stored schedule definition from Supabase.
 * Returns the DB row including timetable_entries, or null if not found.
 */
async function loadStoredSchedule(program, semester, division) {
  const supabase = createServerSupabaseClient();
  if (!supabase) return null;

  try {
    let query = supabase.from('timetable_uploads')
      .select('id, program, semester, division, status, uploaded_at')
      .eq('program', program)
      .eq('semester', semester);
      
    if (division && division !== 'ALL' && division !== 'null') {
      query = query.eq('division', division);
    } else {
      // For programs where division is stored as null (e.g., Pharm D)
      query = query.is('division', null);
    }

    // Pick most recent upload
    query = query.order('uploaded_at', { ascending: false });

    let { data: uploads, error: uploadsError } = await query;
    
    // Graceful fallback: If no upload for exact division (e.g. Sem 7 Div A when Div B was uploaded),
    // check if any upload exists for this program + semester
    if (!uploads || uploads.length === 0) {
      const fallbackQuery = await supabase.from('timetable_uploads')
        .select('id, program, semester, division, status, uploaded_at')
        .eq('program', program)
        .eq('semester', semester)
        .order('uploaded_at', { ascending: false });
      if (fallbackQuery.data && fallbackQuery.data.length > 0) {
        uploads = fallbackQuery.data;
      }
    }

    if (uploadsError || !uploads || uploads.length === 0) return null;

    const uploadId = uploads[0].id;
    const { data: entries, error: entriesError } = await supabase
      .from('timetable_entries')
      .select('*')
      .eq('upload_id', uploadId);

    if (entriesError) return null;

    // Convert DB entries to the expected 'slots' format for processing
    return {
      slots: entries.map(e => ({
        day: e.day,
        period: e.period,
        start_time: e.start_time,
        end_time: e.end_time,
        subject: e.subject,
        code: e.subject_code,
        type: e.class_type,
        batch: e.batch,
        faculty: e.faculty,
        room: e.room
      }))
    };
  } catch (e) {
    console.error(`[workload-generator] Error loading schedule from DB:`, e.message);
    return null;
  }
}

/**
 * Check if a subject name refers to Practice School / Project
 */
function isPracticeSchoolSubject(subject) {
  if (!subject) return false;
  const s = subject.toLowerCase();
  return (
    s.includes('practice school') ||
    s.includes('project') ||
    s.includes('project/') ||
    s.includes('project /') 
  );
}

/**
 * Build slot objects from a stored schedule definition.
 */
export async function generateFullSchedule(program, semester, division, _facultyAssignments = []) {
  const semNum = Number(semester);
  const stored = await loadStoredSchedule(program, semNum, division);

  if (!stored || !stored.slots || stored.slots.length === 0) {
    // No schedule uploaded for this combination — return empty
    return [];
  }

  const slots = [];
  let slotCounter = 0;

  // BUG-7 FIX: Accept optional DB start/end times so parsed times from the
  // uploaded timetable are preserved instead of being overridden by PERIODS.
  const mkSlot = (day, periodIndex, subjectName, subjectCode, classType, batch, facultyName, isSpecial = false, roomNumber = null, dbStartTime = null, dbEndTime = null) => {
    slotCounter++;
    const period = PERIODS[periodIndex];
    if (!period) return null; // Invalid period index

    const isSaturday = day === 'Saturday';

    // Handle free slot labels
    let finalSubject = subjectName;
    let finalClassType = classType;

    if (!subjectName || subjectName === 'FREE' || subjectName === 'NA') {
      finalSubject = isSaturday ? 'VAC/SWAYAM/NPTEL' : 'Assignment/Library';
      finalClassType = 'self_study';
    }

    // Strip FC: prefix from faculty codes (internal parser prefix, not for display)
    const displayFaculty = facultyName && facultyName.startsWith('FC:') ? facultyName.slice(3) : facultyName;
    const cleanRoom = roomNumber ? String(roomNumber).trim() : null;

    // Use DB times if available, otherwise fall back to PERIODS grid
    const finalStartTime = dbStartTime || period.start;
    const finalEndTime = dbEndTime || period.end;

    return {
      id: `slot-${program.replace(/[.\s]/g, '')}-${semester}-${division}-${batch}-${day.slice(0, 3)}-P${periodIndex + 1}-${slotCounter}`,
      program,
      semester: semNum,
      division,
      batch,
      subject: finalSubject,
      subject_code: subjectCode || null,
      class_type: finalClassType,
      faculty: displayFaculty || (finalClassType === 'self_study' || finalClassType === 'recess' ? '' : 'Pending Faculty'),
      day,
      start_time: finalStartTime,
      end_time: finalEndTime,
      period_index: periodIndex,
      room_id: cleanRoom ? `room-${cleanRoom}` : null,
      room: cleanRoom || null,
      parsed_room: cleanRoom || null,
      manually_assigned: false,
      is_special: isSpecial,
    };
  };

  const mkRecessSlot = (day) => ({
    id: `recess-${program.replace(/[.\s]/g, '')}-${semester}-${division}-${day.toLowerCase()}`,
    program,
    semester: semNum,
    division,
    batch: 'ALL',
    subject: 'RECESS',
    class_type: 'recess',
    faculty: '',
    day,
    start_time: RECESS.start,
    end_time: RECESS.end,
    room_id: null,
    room: null,
    manually_assigned: false,
    is_recess: true,
  });

  // ─── Deduplicate raw stored slots ─────────────────────────────
  let rawSchedule = stored.slots;
  const rawDeduped = [];
  const seenRaw = new Set();
  for (const item of rawSchedule) {
    const key = `${item.day}|${item.period}|${item.batch}|${item.subject}|${item.type}`;
    if (!seenRaw.has(key)) {
      seenRaw.add(key);
      rawDeduped.push(item);
    }
  }

  // ─── Use DB period numbers directly (parser assigns correct periods) ──
  const scheduleDef = rawDeduped;

  // ─── Build a lookup set to know which (day, period, batch) already exist ──
  const existingSlotKeys = new Set();
  for (const item of scheduleDef) {
    existingSlotKeys.add(`${item.day}|${item.period}|${item.batch}`);
  }

  // ─── Auto-expand 3-hour practical / Practice School blocks ─────
  // Only expand if the target period slots don't already exist in the data.
  // This prevents doubling entries when the parser already created all 3 periods.
  const expandedDef = [];
  const expandedKeySet = new Set();

  for (const item of scheduleDef) {
    expandedDef.push(item);

    // 1. Practice School / Project 3-hour morning block (expand period 0 to 1, 2)
    if (item.period === 0 && isPracticeSchoolSubject(item.subject)) {
      const psKey = `${item.day}|${item.batch}|PS`;
      if (!expandedKeySet.has(psKey)) {
        expandedKeySet.add(psKey);
        // Only add expanded periods if they don't already exist in parsed data
        if (!existingSlotKeys.has(`${item.day}|1|${item.batch}`)) {
          expandedDef.push({ ...item, period: 1 });
        }
        if (!existingSlotKeys.has(`${item.day}|2|${item.batch}`)) {
          expandedDef.push({ ...item, period: 2 });
        }
      }
    }

    // 2. Practical block (expand starting period to 3 consecutive hours)
    if (item.type === 'practical' && item.batch && item.batch !== 'ALL') {
      const pKey = `${item.day}|${item.batch}|${item.period}`;
      if (!expandedKeySet.has(pKey)) {
        expandedKeySet.add(pKey);
        const p1 = item.period + 1;
        const p2 = item.period + 2;
        // Only add expanded periods if they don't already exist in parsed data
        if (p1 <= 5 && !existingSlotKeys.has(`${item.day}|${p1}|${item.batch}`)) {
          expandedDef.push({ ...item, period: p1 });
        }
        if (p2 <= 5 && !existingSlotKeys.has(`${item.day}|${p2}|${item.batch}`)) {
          expandedDef.push({ ...item, period: p2 });
        }
      }
    }
  }

  // Group by day and build slot objects
  const itemsByDay = {};
  for (const item of expandedDef) {
    if (!itemsByDay[item.day]) itemsByDay[item.day] = [];
    itemsByDay[item.day].push(item);
  }

  const expectedBatches = getBatchesForDivision(program, division);

  for (const dName of DAYS) {
    const dayItems = itemsByDay[dName] || [];
    if (dayItems.length === 0) continue;

    const isSaturday = dName === 'Saturday';

    // Check which periods are occupied by practicals on this day
    const afternoonPracticals = dayItems.filter(i => i.period >= 3 && i.type === 'practical');
    const morningPracticals = dayItems.filter(i => i.period < 3 && (i.type === 'practical' || isPracticeSchoolSubject(i.subject)));

    // Fill missing batches in practical blocks with Assignment/Library
    if (afternoonPracticals.length > 0 && expectedBatches.length > 1) {
      for (let p = 3; p < 6; p++) {
        const pItems = dayItems.filter(i => i.period === p);
        for (const b of expectedBatches) {
          const batchHasEntry = pItems.some(i => i.batch === b || i.batch === 'ALL');
          if (!batchHasEntry) {
            dayItems.push({
              day: dName,
              period: p,
              subject: isSaturday ? 'VAC/SWAYAM/NPTEL' : 'Assignment/Library',
              code: null,
              type: 'practical',
              batch: b,
              faculty: '',
              isSpecial: false,
              _isFiller: true,
            });
          }
        }
      }
    }

    if (morningPracticals.length > 0 && expectedBatches.length > 1) {
      for (let p = 0; p < 3; p++) {
        const pItems = dayItems.filter(i => i.period === p);
        for (const b of expectedBatches) {
          const batchHasEntry = pItems.some(i => i.batch === b || i.batch === 'ALL');
          if (!batchHasEntry) {
            dayItems.push({
              day: dName,
              period: p,
              subject: isSaturday ? 'VAC/SWAYAM/NPTEL' : 'Assignment/Library',
              code: null,
              type: 'practical',
              batch: b,
              faculty: '',
              isSpecial: false,
              _isFiller: true,
            });
          }
        }
      }
    }

    // Morning slots (periods 0-2)
    const morningItems = dayItems.filter(i => i.period < 3);
    morningItems.sort((a, b) => a.period - b.period);
    for (const mi of morningItems) {
      const slot = mkSlot(dName, mi.period, mi.subject, mi.code, mi.type, mi.batch, mi.faculty, mi.isSpecial || false, mi.room || null, mi.start_time || null, mi.end_time || null);
      if (slot) {
        if (mi._isFiller) {
          slot.class_type = mi.type === 'practical' ? 'practical' : 'self_study';
          slot.is_self_study_filler = true;
        }
        slots.push(slot);
      }
    }

    // Recess
    slots.push(mkRecessSlot(dName));

    // Afternoon slots (periods 3-5)
    const afternoonItems = dayItems.filter(i => i.period >= 3);
    afternoonItems.sort((a, b) => a.period - b.period);
    for (const ai of afternoonItems) {
      const slot = mkSlot(dName, ai.period, ai.subject, ai.code, ai.type, ai.batch, ai.faculty, ai.isSpecial || false, ai.room || null, ai.start_time || null, ai.end_time || null);
      if (slot) {
        if (ai._isFiller) {
          slot.class_type = ai.type === 'practical' ? 'practical' : 'self_study';
          slot.is_self_study_filler = true;
        }
        slots.push(slot);
      }
    }
  }

  return slots;
}
