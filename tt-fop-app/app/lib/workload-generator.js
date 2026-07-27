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
      .select('id, program, semester, division')
      .eq('program', program)
      .eq('semester', semester);
      
    if (division && division !== 'ALL') {
      query = query.eq('division', division);
    } else {
      query = query.is('division', null);
    }

    const { data: uploads, error: uploadsError } = await query;
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
 * Build slot objects from a stored schedule definition.
 * 
 * Rules:
 * - Theory/self_study slots: created directly, one per defined entry.
 * - Practical slots: if defined at period 3 only (one entry per batch per day),
 *   auto-expanded to 3 consecutive slots (periods 3, 4, 5).
 * - If already defined at periods 3, 4, AND 5, no expansion needed.
 * - Recess is injected automatically for each day.
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

  const mkSlot = (day, periodIndex, subjectName, subjectCode, classType, batch, facultyName, isSpecial = false) => {
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

    return {
      id: `slot-${program.replace(/[.\s]/g, '')}-${semester}-${division}-${batch}-${day.slice(0, 3)}-P${periodIndex + 1}-${slotCounter}`,
      program,
      semester: semNum,
      division,
      batch,
      subject: finalSubject,
      subject_code: subjectCode || null,
      class_type: finalClassType,
      faculty: facultyName || (finalClassType === 'self_study' || finalClassType === 'recess' ? '' : 'Pending Faculty'),
      day,
      start_time: period.start,
      end_time: period.end,
      period_index: periodIndex,
      room_id: null,
      room: null,
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

  // ─── Process the stored schedule definition ───────────────────
  const scheduleDef = stored.slots;

  // Auto-expand practical slots: if a practical is only defined at one period per day+batch,
  // expand it to 3 consecutive periods (the 3-hour lab block).
  const expandedDef = [];
  const practicalDayBatchSet = new Set(); // track "day|batch|period" for dedup

  for (const item of scheduleDef) {
    expandedDef.push(item);

    // For practical slots at the starting period, check if subsequent periods are already defined
    if (item.type === 'practical' && item.batch && item.batch !== 'ALL') {
      const key = `${item.day}|${item.batch}`;
      
      // Check if periods 4 and 5 (or period+1 and period+2) are already defined for this day+batch
      const nextPeriod1 = scheduleDef.find(s => 
        s.day === item.day && s.batch === item.batch && s.type === 'practical' && s.period === item.period + 1
      );
      const nextPeriod2 = scheduleDef.find(s => 
        s.day === item.day && s.batch === item.batch && s.type === 'practical' && s.period === item.period + 2
      );

      // Only auto-expand if the next two periods are NOT already defined
      if (!nextPeriod1 && !nextPeriod2 && !practicalDayBatchSet.has(key)) {
        practicalDayBatchSet.add(key);
        // Add period+1 and period+2 as copies
        expandedDef.push({ ...item, period: item.period + 1 });
        expandedDef.push({ ...item, period: item.period + 2 });
      }
    }
  }

  // Group by day and sort
  const itemsByDay = {};
  for (const item of expandedDef) {
    if (!itemsByDay[item.day]) itemsByDay[item.day] = [];
    itemsByDay[item.day].push(item);
  }

  for (const dName of DAYS) {
    const dayItems = itemsByDay[dName] || [];
    if (dayItems.length === 0) continue; // No slots on this day

    // Morning slots (periods 0-2)
    const morningItems = dayItems.filter(i => i.period < 3);
    for (const mi of morningItems) {
      const slot = mkSlot(dName, mi.period, mi.subject, mi.code, mi.type, mi.batch, mi.faculty, mi.isSpecial || false);
      if (slot) slots.push(slot);
    }

    // Recess
    slots.push(mkRecessSlot(dName));

    // Afternoon slots (periods 3-5)
    const afternoonItems = dayItems.filter(i => i.period >= 3);
    for (const ai of afternoonItems) {
      const slot = mkSlot(dName, ai.period, ai.subject, ai.code, ai.type, ai.batch, ai.faculty, ai.isSpecial || false);
      if (slot) slots.push(slot);
    }
  }

  return slots;
}

/**
 * Check if a schedule exists for a given program/semester/division.
 */
export function hasStoredSchedule(program, semester, division) {
  const fileName = scheduleKey(program, Number(semester), division);
  const filePath = resolve(SCHEDULES_DIR, fileName);
  return existsSync(filePath);
}
