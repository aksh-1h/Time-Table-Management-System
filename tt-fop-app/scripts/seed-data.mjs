/**
 * seed-data.mjs — Parse JSON data files and seed Supabase tables
 * 
 * Usage:
 *   1. Set env vars in .env.local (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
 *   2. Run the SQL migration in Supabase SQL Editor first
 *   3. Run: node scripts/seed-data.mjs
 * 
 * This script reads:
 *   - "Book1.json"                          → rooms table
 *   - "Combined WL_Odd_26-27.json"          → faculties, subjects, faculty_subject_assignments
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

// ─── Supabase Client (service role for seeding — bypasses RLS) ──────────
// Read from .env.local manually since this is a standalone script
function loadEnv() {
  try {
    const envPath = resolve(__dirname, '..', '.env.local');
    const envContent = readFileSync(envPath, 'utf-8');
    const vars = {};
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      vars[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
    }
    return vars;
  } catch (e) {
    console.error('❌ Could not read .env.local — copy .env.local.example and fill in your Supabase credentials.');
    process.exit(1);
  }
}

const env = loadEnv();
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY || SUPABASE_URL.includes('YOUR_PROJECT')) {
  console.error('❌ Supabase credentials not set. Update .env.local with real values.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

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
    if (program && program.toLowerCase().includes('m pharm')) return 15;
    if (program && program.toLowerCase().includes('m. pharm')) return 15;
    return 30; // UG labs
  }
  if (category === 'seminar_hall') return 75;
  if (category === 'machine_room') return 20;
  if (category === 'instrumentation_lab') return 20;
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

function parseRoomsData() {
  // Book1.json is a bare comma-separated list without [ ] brackets — wrap it
  const fileContent = readFileSync(resolve(ROOT, 'Book1.json'), 'utf-8').trim();
  const raw = JSON.parse(`[${fileContent}]`);
  const rooms = [];
  const seenRoomNos = new Set();
  let placeholderIdx = 0;

  // Skip section headers, null entries, and the header row
  const skipTypes = ['Room type ', 'Laboratories', 'Other facilties'];

  for (const entry of raw) {
    if (!entry) continue;
    const roomType = entry['Infrastructure details- PIP'];
    if (!roomType || skipTypes.includes(roomType.trim())) continue;

    // Skip non-schedulable rooms AND other facilities
    const category = categorizeRoom(roomType);
    if (category === 'preparation_room' || category === 'library' || category === 'animal_house' ||
        category === 'museum' || category === 'drug_info_centre' || category === 'other' ||
        category === 'seminar_hall' || category === 'computer_lab' ||
        category === 'instrumentation_lab' || category === 'machine_room') {
      continue; // Not schedulable or excluded (other facilities)
    }

    const roomNo = entry['Column12'];
    const program = entry['Column14'];
    const normalizedProgram = normalizeProgram(program);

    // Handle missing room numbers
    let roomNoStr;
    if (roomNo === undefined || roomNo === null) {
      placeholderIdx++;
      roomNoStr = `TBD-${placeholderIdx}`;
    } else {
      roomNoStr = String(roomNo).trim();
    }

    // Deduplicate: same physical room number = same physical room
    // Some rooms serve multiple lab functions (e.g., room 103 = Pharmaceutics Lab & Pharma Tech Lab)
    // Keep each unique room_no only once; the room_name reflects its primary identity
    if (seenRoomNos.has(roomNoStr)) continue;
    seenRoomNos.add(roomNoStr);

    rooms.push({
      room_no: roomNoStr,
      room_name: roomType.trim(),
      category,
      program: normalizedProgram,
      capacity: deriveCapacity(category, program),
      is_active: true,
    });
  }

  return rooms;
}

// ═══════════════════════════════════════════════════════════════
// SECTION 2: FACULTIES & SUBJECTS
// ═══════════════════════════════════════════════════════════════

function normalizeFacultyName(raw) {
  if (!raw) return null;
  let name = raw.trim();
  // Remove leading \n
  name = name.replace(/^\n+/, '').trim();
  // Skip placeholders
  if (name === 'NF' || name === 'New Faculty' || name === '-' || name === '') return null;
  return name;
}

function splitFacultyNames(rawField) {
  if (!rawField) return [];
  // Split by &, /, , (comma) — but careful with "Dr. A & Dr. B" patterns
  // Replace \/ with /
  let cleaned = rawField.replace(/\\\//g, '/');
  // Split on  &  or  /  or  , 
  const parts = cleaned.split(/\s*[&\/,]\s*/);
  return parts
    .map(normalizeFacultyName)
    .filter(Boolean);
}

function extractDesignation(name) {
  if (name.startsWith('Dr.') || name.startsWith('Dr ')) return 'Dr.';
  if (name.startsWith('Mr.') || name.startsWith('Mr ')) return 'Mr.';
  if (name.startsWith('Ms.') || name.startsWith('Ms ')) return 'Ms.';
  if (name.startsWith('Mrs.') || name.startsWith('Mrs ')) return 'Mrs.';
  return null;
}

function parseFacultySubjectsData() {
  const raw = JSON.parse(readFileSync(resolve(ROOT, 'Combined WL_Odd_26-27.json'), 'utf-8'));
  
  const allFacultyNames = new Set();
  const allSubjects = [];
  const allAssignments = []; // { facultyName, subjectCode, classType, division, program, specialization }

  // ─── M.PHARM ──────────────────────────────────────────────
  let currentSpec = null;
  let currentSem = null;
  
  for (const entry of raw.MPH) {
    if (!entry) continue;
    
    const yearSem = entry['PARUL INSTITUTE OF PHARMACY, PARUL UNIVERSITY'];
    const subjectCode = entry['Column2'];
    const subjectName = entry['Column3'];
    const theoryDivA = entry['Column4'];
    
    // Skip header/footer rows
    if (yearSem === 'M.PHARM SUBJECT ALLOCATION ODD SEM 2026-27') continue;
    if (yearSem === 'Year /Sem' || yearSem === 'PRINCIPAL') continue;
    
    // Detect semester and specialization from year/sem field
    if (yearSem && typeof yearSem === 'string' && yearSem !== 'PRINCIPAL') {
      // Parse entries like "1\n Pharmaceutics", "1 PHARMACEUTICAL TECHNOLOGY", "1 - Quality Assurence", etc.
      const semMatch = yearSem.match(/^(\d)/);
      if (semMatch) {
        currentSem = parseInt(semMatch[1]);
        // Extract specialization
        const specPart = yearSem.replace(/^\d+\s*[-\n]?\s*/, '').trim();
        if (specPart) {
          currentSpec = specPart;
        }
      } else if (typeof yearSem === 'number') {
        currentSem = yearSem;
      }
    } else if (typeof yearSem === 'number') {
      currentSem = yearSem;
      currentSpec = null; // Common subject
    }
    
    // Skip if no subject name
    if (!subjectName) continue;
    
    // Determine class type
    const isLabel = (subjectName === 'MPAT Theory' || subjectName === 'MPAT Practical');
    const isPractical = subjectName.toLowerCase().includes('practical') || 
                        (subjectCode && subjectCode.endsWith && subjectCode.endsWith('P'));
    const classType = isPractical ? 'practical' : 'theory';
    
    // Build subject code — some entries don't have one
    const code = subjectCode && subjectCode !== '-' ? String(subjectCode).trim() : 
                 `MPH-${currentSpec || 'COMMON'}-${currentSem || 0}-${subjectName.slice(0, 10).replace(/\s+/g, '')}`;
    
    allSubjects.push({
      subject_code: code,
      subject_name: subjectName.trim(),
      program: 'M.Pharm',
      specialization: currentSpec,
      semester: currentSem,
      class_type: classType,
    });
    
    // Extract faculty
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

  // ─── B.PHARM ──────────────────────────────────────────────
  currentSem = null;
  
  for (const entry of raw.BPH) {
    if (!entry) continue;
    
    const yearSem = entry['PARUL INSTITUTE OF PHARMACY, PARUL UNIVERSITY'];
    const subjectCode = entry['Column2'];
    const subjectName = entry['Column3'];
    const theoryDivA = entry['Column4'];
    const theoryDivB = entry['Column6'];
    
    // Skip header/footer rows
    if (yearSem === 'B.PHARM SUBJECT ALLOCATION ODD SEM 2026-27') continue;
    if (yearSem === 'Year /Sem' || yearSem === 'PRINCIPAL') continue;
    
    // Detect semester from year/sem field
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
    
    // For "PRACTICAL" rows, they reference the previous subject's code — 
    // we handle that by using the subject code if present, otherwise generate
    const code = subjectCode ? String(subjectCode).trim() : 
                 `BPH-${currentSem || 0}-${subjectName.slice(0, 15).replace(/\s+/g, '')}`;
    
    allSubjects.push({
      subject_code: code,
      subject_name: subjectName.trim(),
      program: 'B.Pharm',
      specialization: null,
      semester: currentSem,
      class_type: classType,
    });
    
    // Division A faculty
    if (theoryDivA) {
      const names = splitFacultyNames(theoryDivA);
      for (const name of names) {
        allFacultyNames.add(name);
        allAssignments.push({
          facultyName: name,
          subjectCode: code,
          classType,
          division: 'A',
          program: 'B.Pharm',
        });
      }
    }
    
    // Division B faculty
    if (theoryDivB) {
      const names = splitFacultyNames(theoryDivB);
      for (const name of names) {
        allFacultyNames.add(name);
        allAssignments.push({
          facultyName: name,
          subjectCode: code,
          classType,
          division: 'B',
          program: 'B.Pharm',
        });
      }
    }
  }

  // ─── PHARM D ──────────────────────────────────────────────
  let currentYear = null;
  
  for (const entry of raw.PD) {
    if (!entry) continue;
    
    const yearSem = entry['PARUL INSTITUTE OF PHARMACY, PARUL UNIVERSITY'];
    const subjectCode = entry['Column2'];
    const subjectName = entry['Column3'];
    const theoryPractical = entry['Column4'];
    
    // Skip header/footer
    if (yearSem === 'Pharm D, SUBJECT ALLOCATION ODD SEM 2026-27') continue;
    if (yearSem === 'Year /Sem' || yearSem === 'PRINCIPAL') continue;
    
    // Detect year
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
    
    allSubjects.push({
      subject_code: code,
      subject_name: subjectName.trim(),
      program: 'Pharm D',
      specialization: null,
      semester: currentYear, // For Pharm D, semester = year
      class_type: classType,
    });
    
    if (theoryPractical) {
      const names = splitFacultyNames(theoryPractical);
      for (const name of names) {
        allFacultyNames.add(name);
        allAssignments.push({
          facultyName: name,
          subjectCode: code,
          classType,
          division: null,
          program: 'Pharm D',
        });
      }
    }
  }

  // Build unique faculty list with designations
  const faculties = [...allFacultyNames].map(name => ({
    name,
    designation: extractDesignation(name),
  }));

  return { faculties, subjects: allSubjects, assignments: allAssignments };
}

// ═══════════════════════════════════════════════════════════════
// SECTION 3: SEED EXECUTION
// ═══════════════════════════════════════════════════════════════

async function seedRooms() {
  console.log('\n🏢 Seeding rooms...');
  const rooms = parseRoomsData();
  console.log(`   Parsed ${rooms.length} schedulable rooms`);
  
  // Upsert to handle re-runs
  const { data, error } = await supabase
    .from('rooms')
    .upsert(rooms, { onConflict: 'room_no', ignoreDuplicates: false })
    .select();
  
  if (error) {
    console.error('   ❌ Error inserting rooms:', error.message);
    return;
  }
  console.log(`   ✅ Inserted/updated ${data.length} rooms`);
  
  // Print summary
  const cats = {};
  for (const r of rooms) {
    cats[r.category] = (cats[r.category] || 0) + 1;
  }
  console.log('   Category breakdown:');
  for (const [cat, count] of Object.entries(cats).sort()) {
    console.log(`     ${cat}: ${count}`);
  }
}

async function seedFacultiesAndSubjects() {
  const { faculties, subjects, assignments } = parseFacultySubjectsData();
  
  // ─── FACULTIES ──────────────────────────────────────────
  console.log('\n👩‍🏫 Seeding faculties...');
  console.log(`   Parsed ${faculties.length} unique faculty members`);
  
  const { data: facultyData, error: fErr } = await supabase
    .from('faculties')
    .upsert(faculties, { onConflict: 'name', ignoreDuplicates: false })
    .select();
  
  if (fErr) {
    console.error('   ❌ Error inserting faculties:', fErr.message);
    return;
  }
  console.log(`   ✅ Inserted/updated ${facultyData.length} faculties`);
  
  // Build name → id map
  const facultyMap = {};
  for (const f of facultyData) {
    facultyMap[f.name] = f.id;
  }
  
  // ─── SUBJECTS ───────────────────────────────────────────
  console.log('\n📚 Seeding subjects...');
  console.log(`   Parsed ${subjects.length} subject entries`);
  
  // Deduplicate subjects by (code + class_type + program + specialization)
  const subjKey = (s) => `${s.subject_code}|${s.class_type}|${s.program}|${s.specialization || ''}`;
  const uniqueSubjects = [];
  const seenSubjects = new Set();
  for (const s of subjects) {
    const key = subjKey(s);
    if (!seenSubjects.has(key)) {
      seenSubjects.add(key);
      uniqueSubjects.push(s);
    }
  }
  console.log(`   Deduplicated to ${uniqueSubjects.length} unique subjects`);
  
  // Insert in batches (Supabase has payload limits)
  const BATCH_SIZE = 50;
  let insertedSubjects = [];
  for (let i = 0; i < uniqueSubjects.length; i += BATCH_SIZE) {
    const batch = uniqueSubjects.slice(i, i + BATCH_SIZE);
    const { data, error } = await supabase
      .from('subjects')
      .upsert(batch, { onConflict: 'subject_code,class_type,program,COALESCE(specialization,\'\')', ignoreDuplicates: true })
      .select();
    
    if (error) {
      // Try individual inserts if batch fails (unique constraint issues)
      console.log(`   ⚠ Batch upsert issue, falling back to individual inserts...`);
      for (const sub of batch) {
        const { data: singleData, error: singleErr } = await supabase
          .from('subjects')
          .insert(sub)
          .select()
          .single();
        
        if (singleErr) {
          if (singleErr.code === '23505') {
            // Duplicate — fetch existing
            const { data: existing } = await supabase
              .from('subjects')
              .select()
              .eq('subject_code', sub.subject_code)
              .eq('class_type', sub.class_type)
              .eq('program', sub.program)
              .limit(1)
              .single();
            if (existing) insertedSubjects.push(existing);
          } else {
            console.error(`     ❌ Error inserting ${sub.subject_code}: ${singleErr.message}`);
          }
        } else if (singleData) {
          insertedSubjects.push(singleData);
        }
      }
    } else if (data) {
      insertedSubjects.push(...data);
    }
  }
  
  console.log(`   ✅ Inserted/found ${insertedSubjects.length} subjects`);
  
  // Build subject lookup: (code + classType) → id
  const subjectMap = {};
  for (const s of insertedSubjects) {
    subjectMap[`${s.subject_code}|${s.class_type}`] = s.id;
  }
  
  // If we didn't get all subjects via upsert, fetch them all
  if (insertedSubjects.length < uniqueSubjects.length) {
    console.log('   ℹ Fetching all subjects from DB to build complete map...');
    const { data: allSubs } = await supabase.from('subjects').select();
    if (allSubs) {
      for (const s of allSubs) {
        subjectMap[`${s.subject_code}|${s.class_type}`] = s.id;
      }
    }
  }
  
  // ─── FACULTY-SUBJECT ASSIGNMENTS ────────────────────────
  console.log('\n🔗 Seeding faculty-subject assignments...');
  console.log(`   Parsed ${assignments.length} assignment entries`);
  
  const assignmentRows = [];
  let skipped = 0;
  
  for (const a of assignments) {
    const facultyId = facultyMap[a.facultyName];
    const subjectId = subjectMap[`${a.subjectCode}|${a.classType}`];
    
    if (!facultyId || !subjectId) {
      skipped++;
      continue;
    }
    
    assignmentRows.push({
      faculty_id: facultyId,
      subject_id: subjectId,
      division: a.division,
      role: 'instructor',
      academic_year: '2026-27',
    });
  }
  
  console.log(`   Resolved ${assignmentRows.length} assignments (skipped ${skipped} unmatched)`);
  
  // Insert in batches
  let totalInserted = 0;
  for (let i = 0; i < assignmentRows.length; i += BATCH_SIZE) {
    const batch = assignmentRows.slice(i, i + BATCH_SIZE);
    const { data, error } = await supabase
      .from('faculty_subject_assignments')
      .insert(batch)
      .select();
    
    if (error) {
      console.error(`   ❌ Error in assignment batch: ${error.message}`);
    } else if (data) {
      totalInserted += data.length;
    }
  }
  
  console.log(`   ✅ Inserted ${totalInserted} faculty-subject assignments`);
  
  // Print program breakdown
  const programCounts = {};
  for (const s of uniqueSubjects) {
    programCounts[s.program] = (programCounts[s.program] || 0) + 1;
  }
  console.log('\n   Subject breakdown by program:');
  for (const [prog, count] of Object.entries(programCounts)) {
    console.log(`     ${prog}: ${count}`);
  }
}

// ─── MAIN ─────────────────────────────────────────────────────
async function main() {
  console.log('╔════════════════════════════════════════╗');
  console.log('║   TT-FOP Database Seeder               ║');
  console.log('╚════════════════════════════════════════╝');
  console.log(`\nSupabase URL: ${SUPABASE_URL}`);
  
  try {
    await seedRooms();
    await seedFacultiesAndSubjects();
    
    console.log('\n────────────────────────────────────────');
    console.log('✅ Seeding complete!');
    console.log('────────────────────────────────────────\n');
  } catch (err) {
    console.error('\n❌ Fatal error:', err);
    process.exit(1);
  }
}

main();
