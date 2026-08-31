/**
 * room-allocation-map.js
 * 
 * Pre-defined room allocation from "pharmacy - rooms alloted.txt".
 * Each program/semester/division has deterministic room assignments:
 *   - Theory classes → ONE fixed classroom
 *   - Practical classes → a pool of lab rooms (assigned round-robin)
 * 
 * This eliminates the need for a constraint-satisfaction solver.
 */

// ═══════════════════════════════════════════════════════════════
// B.PHARM ROOM ALLOCATIONS
// ═══════════════════════════════════════════════════════════════

const BPHARM_THEORY = {
  '1|A': '404',
  '1|B': '407',
  '3|A': '404',
  '3|B': '407',
  '5|A': '303',
  '5|B': '304',
  '7|A': '303',
  '7|B': '304',
};

const BPHARM_LABS = {
  '1|A': ['311', '409', '201 A', '408', '401 B'],
  '1|B': ['311', '409', '201 A', '201 B', '408', '401 B'],
  '3|A': ['201 A', '103', '309', '311'],
  '3|B': ['201 A', '103', '309', '311'],
  '5|A': ['104', '401 A', '410'],
  '5|B': ['104', '401 A', '410'],
  '7|A': ['104', '201 B', '204', '401 B', '410', '368'],
  '7|B': ['104', '201 B', '204', '401 B', '410', '368'],
};

// ═══════════════════════════════════════════════════════════════
// M.PHARM ROOM ALLOCATIONS
// Divisions are specializations (mapped by short code)
// 9 Canonical Specializations:
// 1. Pharmaceutics
// 2. Pharmachemistry / Pharmaceutical Chemistry
// 3. Pharmacology
// 4. Pharmacognosy
// 5. Phytopharmacy and Phytomedicine
// 6. Pharmaceutical Technology / Techno
// 7. QA (Quality Assurance)
// 8. RA (Regulatory Affairs)
// 9. PP (Pharmacy Practice)
// ═══════════════════════════════════════════════════════════════

const MPHARM_SPEC_MAP = {
  'Pharmaceutics': 'ceutics',
  'Pharmachemistry': 'chemistry',
  'Pharmaceutical Chemistry': 'chemistry',
  'Pharmacology': 'cology',
  'Pharmacognosy': 'cognosy',
  'Phytopharmacy and Phytomedicine': 'Phyto',
  'Phytopharmacy & Phytomedicine': 'Phyto',
  'Phytopharmacy': 'Phyto',
  'Phyto': 'Phyto',
  'Pharmaceutical Technology': 'techno',
  'Techno': 'techno',
  'Pharmaceutical Analysis': 'PA',
  'PA': 'PA',
  'QA': 'QA',
  'Quality Assurance': 'QA',
  'RA': 'RA',
  'Regulatory Affairs': 'RA',
  'PP': 'PP',
  'Pharmacy Practice': 'PP',
};

const MPHARM_THEORY = {
  'ceutics':   ['305', '403'],
  'chemistry': ['403', 'OSH', '370', '364'],
  'cology':    ['402', '370'],
  'cognosy':   ['370', '403'],
  'PA':        ['387', '403'],
  'Phyto':     ['403', '368', '387'],
  'techno':    ['403', 'OSH'],
  'QA':        ['403'],
  'RA':        ['207'],
  'PP':        ['373'],
};

const MPHARM_LABS = {
  'ceutics':   ['103', '205', '206'],
  'chemistry': ['210', '401 A'],
  'cology':    ['410', '401 B'],
  'cognosy':   ['401 A', '204'],
  'PA':        ['204'],
  'Phyto':     ['401 A'],
  'techno':    ['104', '401 B'],
  'QA':        ['205'],
  'RA':        ['207'],
  'PP':        ['PSH'],
};

// ═══════════════════════════════════════════════════════════════
// PHARM D ROOM ALLOCATIONS
// ═══════════════════════════════════════════════════════════════

const PHARMD_THEORY = {
  '1': '366',
  '2': '368',
  '3': '364',
  '4': '377',
  '5': '372',
};

const PHARMD_LABS = {
  '1': ['309', '410', '201 A', '201 B'],
  '2': ['401 A', '309', 'PSH'],
  '3': ['204', '410', 'PSH', '201 B', '104'],
  '4': ['PSH', '103'],
  '5': ['PSH'],
};

// ═══════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════

/**
 * Get the pre-allocated theory classroom for a given program/semester/division.
 * Returns a room number string, or null if not found.
 */
export function getTheoryRoom(program, semester, division, specialization) {
  const sem = String(semester);

  if (program === 'B.Pharm') {
    const div = division || 'A';
    return BPHARM_THEORY[`${sem}|${div}`] || null;
  }

  if (program === 'M.Pharm') {
    const specKey = resolveSpecKey(specialization);
    if (!specKey) return null;
    const rooms = MPHARM_THEORY[specKey];
    // For M.Pharm theory, return the first (primary) classroom
    return rooms ? rooms[0] : null;
  }

  if (program === 'Pharm D') {
    return PHARMD_THEORY[sem] || null;
  }

  return null;
}

/**
 * Get the pre-allocated lab room pool for a given program/semester/division.
 * Returns an array of room number strings, or empty array.
 */
export function getLabRooms(program, semester, division, specialization) {
  const sem = String(semester);

  if (program === 'B.Pharm') {
    const div = division || 'A';
    return BPHARM_LABS[`${sem}|${div}`] || [];
  }

  if (program === 'M.Pharm') {
    const specKey = resolveSpecKey(specialization);
    if (!specKey) return [];
    return MPHARM_LABS[specKey] || [];
  }

  if (program === 'Pharm D') {
    return PHARMD_LABS[sem] || [];
  }

  return [];
}

/**
 * Get ALL theory rooms for M.Pharm (some specs have multiple theory rooms).
 */
export function getTheoryRooms(program, semester, division, specialization) {
  if (program === 'M.Pharm') {
    const specKey = resolveSpecKey(specialization);
    if (!specKey) return [];
    return MPHARM_THEORY[specKey] || [];
  }
  // For B.Pharm and Pharm D, theory is a single room
  const single = getTheoryRoom(program, semester, division, specialization);
  return single ? [single] : [];
}

/**
 * Resolve M.Pharm specialization to the short key used in room allocation.
 */
function resolveSpecKey(specialization) {
  if (!specialization) return null;
  
  // Direct match
  if (MPHARM_THEORY[specialization]) return specialization;
  
  // Map from full name
  const mapped = MPHARM_SPEC_MAP[specialization];
  if (mapped) return mapped;
  
  // Fuzzy match
  const specLower = specialization.toLowerCase().trim();
  if (specLower === 'pp' || specLower.includes('practice') || specLower.includes('pharmacy practice')) return 'PP';
  if (specLower === 'qa' || specLower.includes('quality') || specLower.includes('assurance')) return 'QA';
  if (specLower === 'ra' || specLower.includes('regulatory') || specLower.includes('affairs')) return 'RA';
  if (specLower.includes('pharmaceutics') || specLower.includes('ceutics')) return 'ceutics';
  if (specLower.includes('chemistry') || specLower.includes('pharmachemistry')) return 'chemistry';
  if (specLower.includes('pharmacology') || specLower.includes('cology')) return 'cology';
  if (specLower.includes('pharmacognosy') || specLower.includes('cognosy')) return 'cognosy';
  if (specLower.includes('phyto')) return 'Phyto';
  if (specLower.includes('techno') || specLower.includes('technology') || specLower.includes('industrial')) return 'techno';
  if (specLower.includes('analysis')) return 'PA';
  
  return null;
}

/**
 * Maps subject names or abbreviations to dedicated practical lab rooms.
 * Parul University Pharmacy Department lab allocations:
 *   - GP (General Pharmacy / Pharmaceutics) → 311 (Pharmaceutics Lab 3)
 *   - PCG (Pharmacognosy) → 401 B (Pharmacognosy Lab)
 *   - HPCS (Healthcare Psychology / Communication / Pharmacology) → 408 (Pharmacology Lab 1)
 *   - HAPP I (Human Anatomy & Physiology) → 409 (Anatomy & Physiology Lab)
 *   - PIAC (Pharmaceutical Inorganic & Analytical Chem) → 201 A (Pharm Chem Lab)
 *   - Practice School / Project → 368 (Practice School Hall)
 */
export function resolveSubjectLabRoom(subject, pool = []) {
  if (!subject) return pool[0] || null;
  const s = subject.trim().toLowerCase();
  
  // Specific subject abbreviations and names
  if (/^gp\b/i.test(subject) || s.includes('general pharmacy') || s.includes('pharmaceutics') || s.includes('dispensing')) {
    return '311';
  }
  if (/^pcg\b/i.test(subject) || s.includes('pharmacognosy') || s.includes('phytochem') || s.includes('cognosy')) {
    return '401 B';
  }
  if (/^hpcs\b/i.test(subject) || s.includes('healthcare psychology') || s.includes('communication skills')) {
    return '408';
  }
  if (/^happ\b/i.test(subject) || s.includes('human anatomy') || s.includes('physiology') || s.includes('pathophysiology')) {
    return '409';
  }
  if (/^piac\b/i.test(subject) || s.includes('inorganic') || s.includes('analytical chemistry') || s.includes('pharmaceutical analysis') || s.includes('pharmaceutical chemistry') || s.includes('organic chemistry') || s.includes('medicinal')) {
    return '201 A';
  }
  if (s.includes('pharmacology') || s.includes('cology')) {
    return '408';
  }
  if (s.includes('practice school') || s.includes('project')) {
    return '368';
  }
  
  // Fallback to first available room in pool if provided
  return pool[0] || null;
}

/**
 * Get the complete room allocation map for display purposes.
 * Returns a structured object with all allocations.
 */
export function getAllAllocations() {
  return {
    bpharm: {
      theory: BPHARM_THEORY,
      labs: BPHARM_LABS,
    },
    mpharm: {
      theory: MPHARM_THEORY,
      labs: MPHARM_LABS,
      specMap: MPHARM_SPEC_MAP,
    },
    pharmD: {
      theory: PHARMD_THEORY,
      labs: PHARMD_LABS,
    },
  };
}

