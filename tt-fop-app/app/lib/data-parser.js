/**
 * data-parser.js — Offline data parser for TT-FOP
 * 
 * Reads directly from the JSON dataset files (Book1.json, Combined WL_Odd_26-27.json)
 * to serve data when Supabase is not configured.
 * 
 * This is the SAME parsing logic used in seed-data.mjs, extracted so API routes
 * can serve data without a database connection.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

// Root of the TT_FOP project (parent of tt-fop-app)
const ROOT = resolve(process.cwd(), '..');

// ═══════════════════════════════════════════════════════════════
// SECTION 1: ROOMS
// ═══════════════════════════════════════════════════════════════

function categorizeRoom(roomType) {
  const t = roomType.toLowerCase();
  if (t.includes('class room')) return 'classroom';
  if (t.includes('pharmaceutics lab')) return 'pharmaceutics_lab';
  if (t.includes('pharmaceutical chemistry lab') || t.includes('pharm. chemistry')) return 'pharm_chemistry_lab';
  if (t.includes('pharmacology lab')) return 'pharmacology_lab';
  if (t.includes('pharmacognosy lab')) return 'pharmacognosy_lab';
  if (t.includes('pharmacy practice lab')) return 'pharmacy_practice_lab';
  if (t.includes('phytopharmacy') || t.includes('phytomedicine')) return 'phytopharmacy_lab';
  if (t.includes('quality assurance lab')) return 'quality_assurance_lab';
  if (t.includes('regulatory affairs')) return 'regulatory_affairs_lab';
  if (t.includes('pharmaceutical  analysis lab') || t.includes('pharmaceutical analysis lab')) return 'pharma_analysis_lab';
  if (t.includes('pharmaceutical technology lab')) return 'pharma_technology_lab';
  if (t.includes('machine room')) return 'machine_room';
  if (t.includes('central instrument')) return 'instrumentation_lab';
  if (t.includes('seminar hall')) return 'seminar_hall';
  if (t.includes('computer')) return 'computer_lab';
  if (t.includes('animal house')) return 'animal_house';
  if (t.includes('museum')) return 'museum';
  if (t.includes('drug information')) return 'drug_info_centre';
  if (t.includes('library')) return 'library';
  if (t.includes('preparation room')) return 'preparation_room';
  return 'other';
}

function deriveCapacity(category, program) {
  if (category === 'classroom') {
    if (program && program.toLowerCase().includes('m pharm')) return 15;
    if (program && program.toLowerCase().includes('pharm. d')) return 40;
    if (program && program.toLowerCase().includes('pharm d')) return 40;
    if (program && program.toLowerCase().includes('d. pharm')) return 60;
    return 60; // B.Pharm default
  }
  if (category.includes('_lab')) {
    if (program && (program.toLowerCase().includes('m pharm') || program.toLowerCase().includes('m. pharm'))) return 15;
    return 30; // UG labs
  }
  return 0;
}

function normalizeProgram(rawProgram) {
  if (!rawProgram || rawProgram === 'NA') return null;
  const p = rawProgram.trim();
  if (p.includes('B .Pharm') || p.includes('B.Pharm')) return 'B.Pharm';
  if (p.includes('D. Pharm') || p.includes('D.Pharm')) return 'D.Pharm';
  if (p.includes('Pharm. D') || p.includes('Pharm D') || p.includes('PharmD')) return 'Pharm D';
  if (p.includes('M Pharm') || p.includes('M.Pharm') || p.includes('M. Pharm')) return 'M.Pharm';
  return p;
}

let _roomsCache = null;

export function parseRoomsData() {
  if (_roomsCache) return _roomsCache;
  
  try {
    const fileContent = readFileSync(resolve(ROOT, 'Book1.json'), 'utf-8').trim();
    const raw = JSON.parse(`[${fileContent}]`);
    const rooms = [];
    const seenRoomNos = new Set();
    let placeholderIdx = 0;
    
    const skipTypes = ['Room type ', 'Laboratories', 'Other facilties'];
    
    for (const entry of raw) {
      if (!entry) continue;
      const roomType = entry['Infrastructure details- PIP'];
      if (!roomType || skipTypes.includes(roomType.trim())) continue;
      
      const category = categorizeRoom(roomType);
      if (category === 'preparation_room' || category === 'library' || category === 'animal_house' ||
          category === 'museum' || category === 'drug_info_centre' || category === 'other' ||
          category === 'seminar_hall' || category === 'computer_lab' ||
          category === 'instrumentation_lab' || category === 'machine_room') {
        continue;
      }
      
      const roomNo = entry['Column12'];
      const program = entry['Column14'];
      const normalizedProg = normalizeProgram(program);
      
      let roomNoStr;
      if (roomNo === undefined || roomNo === null) {
        placeholderIdx++;
        roomNoStr = `TBD-${placeholderIdx}`;
      } else {
        roomNoStr = String(roomNo).trim();
      }
      
      if (seenRoomNos.has(roomNoStr)) continue;
      seenRoomNos.add(roomNoStr);
      
      rooms.push({
        id: `room-${roomNoStr}`,
        room_no: roomNoStr,
        room_name: roomType.trim(),
        category,
        program: normalizedProg,
        capacity: deriveCapacity(category, program),
        is_active: true,
      });
    }
    
    _roomsCache = rooms;
    return rooms;
  } catch (err) {
    console.error('[data-parser] Error parsing Book1.json:', err.message);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════
// SECTION 2: FACULTIES & SUBJECTS
// ═══════════════════════════════════════════════════════════════

function normalizeFacultyName(raw) {
  if (!raw) return null;
  let name = raw.trim();
  name = name.replace(/^\n+/, '').trim();
  if (name === 'NF' || name === 'New Faculty' || name === '-' || name === '') return null;
  return name;
}

function splitFacultyNames(rawField) {
  if (!rawField) return [];
  let cleaned = rawField.replace(/\\\//g, '/');
  const parts = cleaned.split(/\s*[&\/,]\s*/);
  return parts.map(normalizeFacultyName).filter(Boolean);
}

function extractDesignation(name) {
  if (name.startsWith('Dr.') || name.startsWith('Dr ')) return 'Dr.';
  if (name.startsWith('Mr.') || name.startsWith('Mr ')) return 'Mr.';
  if (name.startsWith('Ms.') || name.startsWith('Ms ')) return 'Ms.';
  if (name.startsWith('Mrs.') || name.startsWith('Mrs ')) return 'Mrs.';
  return null;
}

let _facultySubjectsCache = null;

export function parseFacultySubjectsData() {
  if (_facultySubjectsCache) return _facultySubjectsCache;
  
  try {
    const raw = JSON.parse(readFileSync(resolve(ROOT, 'Combined WL_Odd_26-27.json'), 'utf-8'));
    
    const allFacultyNames = new Set();
    const allSubjects = [];
    const allAssignments = [];
    let subjectIdx = 0;
    
    // ─── M.PHARM ──────────────────────────────────────────────
    let currentSpec = null;
    let currentSem = null;
    
    if (raw.MPH) {
      for (const entry of raw.MPH) {
        if (!entry) continue;
        const yearSem = entry['PARUL INSTITUTE OF PHARMACY, PARUL UNIVERSITY'];
        const subjectCode = entry['Column2'];
        const subjectName = entry['Column3'];
        const theoryDivA = entry['Column4'];
        
        if (yearSem === 'M.PHARM SUBJECT ALLOCATION ODD SEM 2026-27') continue;
        if (yearSem === 'Year /Sem' || yearSem === 'PRINCIPAL') continue;
        
        if (yearSem && typeof yearSem === 'string' && yearSem !== 'PRINCIPAL') {
          const semMatch = yearSem.match(/^(\d)/);
          if (semMatch) {
            currentSem = parseInt(semMatch[1]);
            const specPart = yearSem.replace(/^\d+\s*[-\n]?\s*/, '').trim();
            if (specPart) currentSpec = specPart;
          }
        } else if (typeof yearSem === 'number') {
          currentSem = yearSem;
          currentSpec = null;
        }
        
        if (!subjectName) continue;
        
        const isPractical = subjectName.toLowerCase().includes('practical') || 
                            (subjectCode && subjectCode.endsWith && subjectCode.endsWith('P'));
        const classType = isPractical ? 'practical' : 'theory';
        
        const code = subjectCode && subjectCode !== '-' ? String(subjectCode).trim() : 
                     `MPH-${currentSpec || 'COMMON'}-${currentSem || 0}-${subjectName.slice(0, 10).replace(/\s+/g, '')}`;
        
        subjectIdx++;
        allSubjects.push({
          id: `subj-${subjectIdx}`,
          subject_code: code,
          subject_name: subjectName.trim(),
          program: 'M.Pharm',
          specialization: currentSpec,
          semester: currentSem,
          class_type: classType,
        });
        
        if (theoryDivA) {
          const names = splitFacultyNames(theoryDivA);
          for (const name of names) {
            allFacultyNames.add(name);
            allAssignments.push({
              facultyName: name,
              subjectCode: code,
              classType,
              division: null,
              program: 'M.Pharm',
              specialization: currentSpec,
            });
          }
        }
      }
    }
    
    // ─── B.PHARM ──────────────────────────────────────────────
    currentSem = null;
    
    if (raw.BPH) {
      for (const entry of raw.BPH) {
        if (!entry) continue;
        const yearSem = entry['PARUL INSTITUTE OF PHARMACY, PARUL UNIVERSITY'];
        const subjectCode = entry['Column2'];
        const subjectName = entry['Column3'];
        const theoryDivA = entry['Column4'];
        const theoryDivB = entry['Column6'];
        
        if (yearSem === 'B.PHARM SUBJECT ALLOCATION ODD SEM 2026-27') continue;
        if (yearSem === 'Year /Sem' || yearSem === 'PRINCIPAL') continue;
        
        if (yearSem && typeof yearSem === 'string') {
          const semMatch = yearSem.match(/\/(\d+)/);
          if (semMatch) currentSem = parseInt(semMatch[1]);
        }
        
        if (!subjectName) continue;
        
        const isPractical = subjectName === 'PRACTICAL' || 
                            subjectName.toLowerCase().includes('practical') ||
                            subjectName.toLowerCase().includes('pract') ||
                            (subjectCode && typeof subjectCode === 'string' && (subjectCode.endsWith('P') || subjectCode.includes('PS')));
        const classType = isPractical ? 'practical' : 'theory';
        
        const code = subjectCode ? String(subjectCode).trim() : 
                     `BPH-${currentSem || 0}-${subjectName.slice(0, 15).replace(/\s+/g, '')}`;
        
        subjectIdx++;
        allSubjects.push({
          id: `subj-${subjectIdx}`,
          subject_code: code,
          subject_name: subjectName.trim(),
          program: 'B.Pharm',
          specialization: null,
          semester: currentSem,
          class_type: classType,
        });
        
        if (theoryDivA) {
          const names = splitFacultyNames(theoryDivA);
          for (const name of names) {
            allFacultyNames.add(name);
            allAssignments.push({ facultyName: name, subjectCode: code, classType, division: 'A', program: 'B.Pharm' });
          }
        }
        if (theoryDivB) {
          const names = splitFacultyNames(theoryDivB);
          for (const name of names) {
            allFacultyNames.add(name);
            allAssignments.push({ facultyName: name, subjectCode: code, classType, division: 'B', program: 'B.Pharm' });
          }
        }
      }
    }
    
    // ─── PHARM D ──────────────────────────────────────────────
    let currentYear = null;
    
    if (raw.PD) {
      for (const entry of raw.PD) {
        if (!entry) continue;
        const yearSem = entry['PARUL INSTITUTE OF PHARMACY, PARUL UNIVERSITY'];
        const subjectCode = entry['Column2'];
        const subjectName = entry['Column3'];
        const theoryPractical = entry['Column4'];
        
        if (yearSem === 'Pharm D, SUBJECT ALLOCATION ODD SEM 2026-27') continue;
        if (yearSem === 'Year /Sem' || yearSem === 'PRINCIPAL') continue;
        
        if (yearSem && typeof yearSem === 'string') {
          const yearMatch = yearSem.match(/(\d+)/);
          if (yearMatch) currentYear = parseInt(yearMatch[1]);
        }
        
        if (!subjectName) continue;
        
        const isPractical = subjectName.toLowerCase().includes('practical') ||
                            subjectName.toLowerCase().includes('(practical)');
        const classType = isPractical ? 'practical' : 'theory';
        
        const code = subjectCode ? String(subjectCode).trim() : 
                     `PD-${currentYear || 0}-${subjectName.slice(0, 15).replace(/\s+/g, '')}`;
        
        subjectIdx++;
        allSubjects.push({
          id: `subj-${subjectIdx}`,
          subject_code: code,
          subject_name: subjectName.trim(),
          program: 'Pharm D',
          specialization: null,
          semester: currentYear,
          class_type: classType,
        });
        
        if (theoryPractical) {
          const names = splitFacultyNames(theoryPractical);
          for (const name of names) {
            allFacultyNames.add(name);
            allAssignments.push({ facultyName: name, subjectCode: code, classType, division: null, program: 'Pharm D' });
          }
        }
      }
    }
    
    // Build unique faculty list
    let facIdx = 0;
    const faculties = [...allFacultyNames].map(name => {
      facIdx++;
      return {
        id: `fac-${facIdx}`,
        name,
        designation: extractDesignation(name),
        is_active: true,
      };
    });
    
    // Deduplicate subjects
    const subjKey = (s) => `${s.subject_code}|${s.class_type}|${s.program}|${s.specialization || ''}`;
    const uniqueSubjects = [];
    const seenSubjects = new Set();
    for (const s of allSubjects) {
      const key = subjKey(s);
      if (!seenSubjects.has(key)) {
        seenSubjects.add(key);
        uniqueSubjects.push(s);
      }
    }
    
    _facultySubjectsCache = { faculties, subjects: uniqueSubjects, assignments: allAssignments };
    return _facultySubjectsCache;
  } catch (err) {
    console.error('[data-parser] Error parsing Combined WL_Odd_26-27.json:', err.message);
    return { faculties: [], subjects: [], assignments: [] };
  }
}

/**
 * Check if Supabase is configured
 */
export function isSupabaseConfigured() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return !!(url && key && !url.includes('YOUR_PROJECT'));
}
