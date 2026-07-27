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
// ═══════════════════════════════════════════════════════════════

const MPHARM_SPEC_MAP = {
  'Pharmaceutics': 'ceutics',
  'Pharmaceutical Chemistry': 'chemistry',
  'Pharmacology': 'cology',
  'Pharmacognosy': 'PA',       // "Div PA" in the source
  'Phytopharmacy': 'Phyto',    // could also be "Phytopharmacy & Phytomedicine"
  'Pharmacy Practice': 'PP',
  'Quality Assurance': 'QA',
  'Regulatory Affairs': 'RA',
  'Industrial Pharmacy': 'techno',
  'Clinical Research': null,    // not listed in allocation — fallback
  // Alternate names
  'Pharmaceutical Analysis': 'PA',
};

const MPHARM_THEORY = {
  'ceutics':   ['305', '403'],
  'chemistry': ['403', 'OSH', '370', '364'],
  'cology':    ['402', '370'],
  'PA':        ['387', '403'],
  'Phyto':     ['403', '368', '387'],
  'PP':        ['373'],
  'QA':        ['403'],
  'RA':        ['207'],
  'techno':    ['403', 'OSH'],
};

const MPHARM_LABS = {
  'ceutics':   ['103', '205', '206'],
  'chemistry': ['210', '401 A'],
  'cology':    ['410', '401 B'],
  'PA':        ['204'],
  'Phyto':     ['401 A'],
  'PP':        ['PSH'],
  'QA':        ['205'],
  'RA':        ['207'],
  'techno':    ['104', '401 B'],
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
  const specLower = specialization.toLowerCase();
  if (specLower.includes('pharmaceutics') || specLower.includes('ceutics')) return 'ceutics';
  if (specLower.includes('chemistry')) return 'chemistry';
  if (specLower.includes('pharmacology') || specLower.includes('cology')) return 'cology';
  if (specLower.includes('pharmacognosy') || specLower.includes('cognosy')) return 'PA';
  if (specLower.includes('analysis')) return 'PA';
  if (specLower.includes('phyto')) return 'Phyto';
  if (specLower.includes('practice')) return 'PP';
  if (specLower.includes('quality') || specLower.includes('qa')) return 'QA';
  if (specLower.includes('regulatory') || specLower.includes('ra')) return 'RA';
  if (specLower.includes('industrial') || specLower.includes('techno')) return 'techno';
  
  return null;
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
