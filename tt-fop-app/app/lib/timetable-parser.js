/**
 * timetable-parser.js — Embedded timetable parser (JavaScript port)
 * ================================================================
 * Faithfully ported from parser-service/parsers/mapper.py + docx_parser.py + pdf_parser.py
 *
 * Parses timetable files (JSON, DOCX, PDF, raw text) directly in the
 * Next.js server without requiring a separate Python service.
 *
 * Key design decisions matching the Python version:
 * - Period map with time markers for flexible matching
 * - Day aliases for abbreviation support (Mon, Tue, Wed, etc.)
 * - Compact format detection ("SUBJECT FACULTY_CODE ROOM_NO")
 * - Formal format detection (Dr./Ms./Prof. titles, Room/Lab prefixes)
 * - Batch grouping for lab sessions
 * - FC: prefix for faculty codes (stripped in UI)
 * - Subject code regex for pharmacy-specific codes (BP101T, MP201P, etc.)
 */

// ── Period definitions (exact match with Python PERIOD_MAP) ──
const PERIOD_MAP = [
  { period: 0, start: '09:30:00', end: '10:30:00', markers: ['09:30', '9:30'] },
  { period: 1, start: '10:30:00', end: '11:30:00', markers: ['10:30'] },
  { period: 2, start: '11:30:00', end: '12:30:00', markers: ['11:30'] },
  // Recess: 12:30 – 13:30
  { period: 3, start: '13:30:00', end: '14:30:00', markers: ['13:30', '01:30', '1:30'] },
  { period: 4, start: '14:30:00', end: '15:30:00', markers: ['14:30', '02:30', '2:30'] },
  { period: 5, start: '15:30:00', end: '16:25:00', markers: ['15:30', '03:30', '3:30'] },
];

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const VALID_DAYS = new Set(DAYS);
const VALID_CLASS_TYPES = new Set(['theory', 'practical', 'self_study']);

// Day aliases (exact match with Python DAY_ALIASES)
const DAY_ALIASES = {
  MONDAY: 'Monday', MON: 'Monday',
  TUESDAY: 'Tuesday', TUE: 'Tuesday', TUES: 'Tuesday',
  WEDNESDAY: 'Wednesday', WED: 'Wednesday',
  THURSDAY: 'Thursday', THU: 'Thursday', THUR: 'Thursday', THURS: 'Thursday',
  FRIDAY: 'Friday', FRI: 'Friday',
  SATURDAY: 'Saturday', SAT: 'Saturday',
};


// ══════════════════════════════════════════════════════════════
// MAPPER FUNCTIONS (faithful port from mapper.py)
// ══════════════════════════════════════════════════════════════

/**
 * Normalize time text for matching.
 * Handles: "9.30", "9:30 AM", "09:30-10:30", "0930", "9:30 am - 10:30 am"
 */
function normalizeTime(timeText) {
  if (!timeText) return '';
  let t = timeText.trim();
  t = t.replace(/\./g, ':');            // "9.30" → "9:30"
  t = t.replace(/\s*(am|pm|AM|PM)\s*/g, ''); // Remove AM/PM
  t = t.replace(/\s+/g, '');            // Remove whitespace
  return t;
}

/**
 * Match a time-cell string to the corresponding period info.
 * Exact port of Python find_period_info().
 */
function findPeriodInfo(timeText) {
  if (!timeText) return null;
  const clean = normalizeTime(timeText);
  for (const p of PERIOD_MAP) {
    for (const marker of p.markers) {
      if (clean.includes(marker)) {
        return { period: p.period, start: p.start, end: p.end };
      }
    }
  }
  // Also try matching raw 4-digit format like "0930"
  const digits = timeText.replace(/[^0-9]/g, '');
  if (digits.length >= 4) {
    const h = parseInt(digits.slice(0, 2), 10);
    const m = parseInt(digits.slice(2, 4), 10);
    for (const p of PERIOD_MAP) {
      const ps = p.start.split(':');
      if (parseInt(ps[0], 10) === h && parseInt(ps[1], 10) === m) {
        return { period: p.period, start: p.start, end: p.end };
      }
    }
  }
  return null;
}

/** Check if cell content indicates a practical/lab session. */
function isLabContent(text) {
  const upper = text.toUpperCase();
  return ['BATCH', 'LAB', 'PRACTICAL'].some(kw => upper.includes(kw));
}

/** Check if a line is purely metadata (faculty/room/batch), not a subject. */
function isMetadataLine(line) {
  return /^\s*(?:Dr\.|Prof\.|Mr\.|Ms\.|Mrs\.)\s+[A-Za-z.\s]+$/i.test(line)
    || /^\s*(?:ROOM|LAB|HALL)\s*[:\-]?\s*[0-9A-Z]+\s*$/i.test(line)
    || /^\s*(?:BATCH|Batch)\s*:?\s*[A-D0-9]\s*$/i.test(line);
}

/**
 * Try to parse a compact-format line like "PM KVT 309" or "POC II AAN 201 A".
 * Returns { subject, faculty (FC:-prefixed), room } or null.
 */
function extractCompactFormat(line) {
  const match = /^(.+?)\s+([A-Z]{2,5})\s+(\d{3}\s*[A-Z]?|PSH)$/.exec(line.trim());
  if (!match) return null;

  const subjectPart = match[1].trim();
  const facultyCode = match[2].trim();
  const roomPart = match[3].trim();

  // Faculty code must be pure alpha (not a subject code which has digits)
  if (!/^[A-Za-z]+$/.test(facultyCode)) return null;
  if (!/^\d{3}\s*[A-Z]?$/.test(roomPart)) return null;

  return {
    subject: subjectPart,
    faculty: `FC:${facultyCode}`,
    room: roomPart,
  };
}

/** Extract faculty, room, batch, subject_code from a single line. */
function extractMetadata(line) {
  const result = { faculty: null, room: null, batch: null, subject_code: null };

  // 1. Faculty with formal title
  const facMatch = /(?:Dr\.|Prof\.|Mr\.|Ms\.|Mrs\.)\s+([A-Za-z.]+(?:\s+[A-Za-z.]+){0,3})/i.exec(line);
  if (facMatch) result.faculty = facMatch[0].trim();

  // 2. Room with keyword prefix
  const roomMatch = /(?:ROOM|LAB|HALL)\s*[:\-]?\s*([0-9]{3}\s*[A-Z]?|PSH)\b/i.exec(line);
  if (roomMatch) result.room = roomMatch[1].trim();

  // 3. Batch detection
  const batchMatch = /(?:BATCH|Batch)\s*:?\s*([A-D0-9])/i.exec(line);
  if (batchMatch) result.batch = batchMatch[1].toUpperCase();

  // 4. Subject code (pharmacy-specific)
  const codeMatch = /\b([A-Z]{1,3}[0-9]{3,4}[A-Z]{0,2})\b/.exec(line);
  if (codeMatch) {
    const candidate = codeMatch[1].trim();
    if (/^[A-Z]{1,3}\d{3}/.test(candidate)) {
      result.subject_code = candidate;
    }
  }

  return result;
}

/**
 * Parse a timetable cell's full text into one or more logical entry blocks.
 * Exact port of Python parse_cell_to_entries().
 */
function parseCellToEntries(cellText) {
  if (!cellText || cellText.trim().length < 2) return [];

  const clean = cellText.trim();
  if (clean.toUpperCase().includes('RECESS')) return [];

  const lines = clean.split('\n').map(ln => ln.trim()).filter(ln => ln);
  if (!lines.length) return [];

  const isLab = isLabContent(clean);

  // Group lines into logical blocks (new block at each "Batch X")
  const blocks = [];
  let currentBlock = [];

  for (const line of lines) {
    const batchMatch = /(?:BATCH|Batch)\s*:?\s*([A-D0-9])/i.exec(line);
    if (batchMatch && currentBlock.length) {
      blocks.push(currentBlock);
      currentBlock = [line];
    } else {
      currentBlock.push(line);
    }
  }
  if (currentBlock.length) blocks.push(currentBlock);

  // Parse each block
  const entries = [];
  for (const blockLines of blocks) {
    const subjectParts = [];
    let faculty = null;
    let room = null;
    let batch = 'ALL';
    let subjectCode = null;

    for (const line of blockLines) {
      // Try compact format first ("PM KVT 309")
      const compact = extractCompactFormat(line);
      if (compact) {
        if (compact.subject && compact.subject.length > 1) subjectParts.push(compact.subject);
        if (compact.faculty && !faculty) faculty = compact.faculty;
        if (compact.room && !room) room = compact.room;
        const codeMatch = /\b([A-Z]{1,3}[0-9]{3,4}[A-Z]{0,2})\b/.exec(compact.subject);
        if (codeMatch && !subjectCode) subjectCode = codeMatch[1];
        continue;
      }

      // Formal format parsing
      const meta = extractMetadata(line);
      if (meta.faculty && !faculty) faculty = meta.faculty;
      if (meta.room && !room) room = meta.room;
      if (meta.batch) batch = meta.batch;
      if (meta.subject_code && !subjectCode) subjectCode = meta.subject_code;

      // If not purely metadata, it contributes to subject name
      if (!isMetadataLine(line)) {
        const subjectLine = line.replace(/(?:BATCH|Batch)\s*:?\s*[A-D0-9]\s*:?\s*/gi, '').trim();
        if (subjectLine && subjectLine.length > 1) subjectParts.push(subjectLine);
      }
    }

    let subject = subjectParts.length ? subjectParts.join(' ').trim() : blockLines[0];
    subject = subject.replace(/\s+/g, ' ').trim();

    if (!subject || subject.length < 2) continue;

    const classType = isLab ? 'practical' : 'theory';

    entries.push({
      subject: subject.slice(0, 80),
      subject_code: subjectCode || null,
      class_type: classType,
      batch: isLab ? batch : 'ALL',
      faculty: faculty || null,
      room: room || null,
    });
  }

  return entries;
}

function buildEntry({ day, period, startTime, endTime, subject, subjectCode, classType, batch, faculty, room }) {
  return {
    day,
    period,
    start_time: startTime || null,
    end_time: endTime || null,
    subject,
    subject_code: subjectCode || null,
    class_type: classType || 'theory',
    batch: batch || 'ALL',
    faculty: faculty || null,
    room: room || null,
  };
}


// ══════════════════════════════════════════════════════════════
// DOCX PARSER (improved — handles merged cells, gridSpan, paragraphs)
// ══════════════════════════════════════════════════════════════

/**
 * Extract text from a DOCX file by reading the ZIP and parsing word/document.xml.
 * Uses Node.js built-in zlib. Handles:
 * - Multiple paragraphs per cell (joined with \n)
 * - gridSpan for horizontally merged cells
 * - Proper text reconstruction from <w:t> elements
 */
function parseDocxFromBuffer(fileBuffer) {
  try {
    const { inflateRawSync } = require('zlib');
    const buf = Buffer.isBuffer(fileBuffer) ? fileBuffer : Buffer.from(fileBuffer);

    // Find End of Central Directory record
    let eocdOffset = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
      if (buf.readUInt32LE(i) === 0x06054b50) {
        eocdOffset = i;
        break;
      }
    }
    if (eocdOffset === -1) {
      console.log('[docx_parser] Not a valid ZIP/DOCX file');
      return [];
    }

    const cdOffset = buf.readUInt32LE(eocdOffset + 16);
    const cdEntryCount = buf.readUInt16LE(eocdOffset + 10);

    let pos = cdOffset;
    for (let i = 0; i < cdEntryCount; i++) {
      if (pos + 46 > buf.length) break;
      if (buf.readUInt32LE(pos) !== 0x02014b50) break;

      const compressedSize = buf.readUInt32LE(pos + 20);
      const uncompressedSize = buf.readUInt32LE(pos + 24);
      const filenameLen = buf.readUInt16LE(pos + 28);
      const extraLen = buf.readUInt16LE(pos + 30);
      const commentLen = buf.readUInt16LE(pos + 32);
      const localHeaderOffset = buf.readUInt32LE(pos + 42);
      const filename = buf.slice(pos + 46, pos + 46 + filenameLen).toString('utf-8');

      if (filename === 'word/document.xml') {
        const localPos = localHeaderOffset;
        if (localPos + 30 > buf.length) break;

        const localFilenameLen = buf.readUInt16LE(localPos + 26);
        const localExtraLen = buf.readUInt16LE(localPos + 28);
        const compressionMethod = buf.readUInt16LE(localPos + 8);
        const dataStart = localPos + 30 + localFilenameLen + localExtraLen;

        if (dataStart + compressedSize > buf.length) break;
        const compData = buf.slice(dataStart, dataStart + compressedSize);

        let xmlContent;
        if (compressionMethod === 0) {
          xmlContent = compData.toString('utf-8');
        } else {
          try {
            xmlContent = inflateRawSync(compData).toString('utf-8');
          } catch (e) {
            console.error('[docx_parser] Inflate error:', e.message);
            return [];
          }
        }

        return parseDocxXml(xmlContent);
      }

      pos += 46 + filenameLen + extraLen + commentLen;
    }

    console.log('[docx_parser] word/document.xml not found in ZIP');
  } catch (e) {
    console.error('[docx_parser] ZIP extraction error:', e.message);
  }
  return [];
}

/**
 * Parse tables from DOCX XML content.
 * Improvements over simple regex:
 * - Handles multiple <w:p> paragraphs per cell (joins with \n for proper block parsing)
 * - Reads <w:gridSpan> to account for horizontally merged cells
 * - Processes cells in order with column index tracking
 */
function parseDocxXml(xmlContent) {
  const entries = [];

  // Extract tables from XML using fast regex
  const tables = xmlContent.match(/<w:tbl[\s\S]*?<\/w:tbl>/g) || [];
  console.log(`[docx_parser] Found ${tables.length} table(s) in XML`);

  for (let tblIdx = 0; tblIdx < tables.length; tblIdx++) {
    const tbl = tables[tblIdx];
    const rowsXml = tbl.match(/<w:tr[\s\S]*?<\/w:tr>/g) || [];
    const grid = [];

    for (const tr of rowsXml) {
      const cellsXml = tr.match(/<w:tc[\s\S]*?<\/w:tc>/g) || [];
      const rowText = [];

      for (const tc of cellsXml) {
        // Extract paragraphs in this cell
        const paragraphs = tc.match(/<w:p[\s\S]*?<\/w:p>/g) || [tc];
        const paraTexts = [];

        for (const p of paragraphs) {
          const tMatches = p.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [];
          const paraText = tMatches
            .map(m => m.replace(/<[^>]+>/g, ''))
            .join('')
            .trim();
          if (paraText) paraTexts.push(paraText);
        }

        // Join paragraphs with newline (for multi-line cell content)
        const cellStr = paraTexts.join('\n').trim();

        // Check for gridSpan (merged columns)
        const gridSpanMatch = /<w:gridSpan\s+w:val="(\d+)"/i.exec(tc);
        const span = gridSpanMatch ? parseInt(gridSpanMatch[1], 10) : 1;

        rowText.push(cellStr);
        for (let s = 1; s < span; s++) {
          rowText.push(cellStr);
        }
      }

      if (rowText.length) grid.push(rowText);
    }

    if (grid.length < 2) continue;

    // Flexible day column detection (check first 3 rows)
    let dayColumns = {};
    for (let r = 0; r < Math.min(3, grid.length); r++) {
      const candidate = findDayColumnsFlexible(grid[r]);
      if (Object.keys(candidate).length >= 2) {
        dayColumns = candidate;
        break;
      }
    }

    if (!Object.keys(dayColumns).length) {
      console.log(`[docx_parser] Table ${tblIdx}: No day columns detected. First row: ${JSON.stringify((grid[0] || []).slice(0, 7).map(s => s.slice(0, 30)))}`);
      continue;
    }

    console.log(`[docx_parser] Table ${tblIdx}: Detected days: ${JSON.stringify(dayColumns)}`);

    // Process data rows
    for (let r = 1; r < grid.length; r++) {
      const row = grid[r];
      if (row.length < 2) continue;

      const timeText = row[0].trim();
      if (timeText.toUpperCase().includes('RECESS')) continue;

      const slotInfo = findPeriodInfo(timeText);
      if (!slotInfo) {
        if (timeText && timeText.length > 1 && !['RECESS', 'BREAK', 'LUNCH'].some(s => timeText.toUpperCase().includes(s))) {
          console.log(`[docx_parser] Table ${tblIdx}, Row ${r}: Could not match time '${timeText}' to any period`);
        }
        continue;
      }

      const processedCells = new Set();

      for (const [colIdxStr, dayName] of Object.entries(dayColumns)) {
        const ci = parseInt(colIdxStr, 10);
        if (ci >= row.length) continue;

        const cellText = row[ci].trim();
        if (!cellText || cellText.length < 2 || cellText.toUpperCase().includes('RECESS')) continue;

        const cellKey = `${dayName}|${slotInfo.period}|${cellText}`;
        if (processedCells.has(cellKey)) continue;
        processedCells.add(cellKey);

        const cellEntries = parseCellToEntries(cellText);
        for (const parsed of cellEntries) {
          entries.push(buildEntry({
            day: dayName,
            period: slotInfo.period,
            startTime: slotInfo.start,
            endTime: slotInfo.end,
            subject: parsed.subject,
            subjectCode: parsed.subject_code,
            classType: parsed.class_type,
            batch: parsed.batch,
            faculty: parsed.faculty,
            room: parsed.room,
          }));
        }
      }
    }
  }

  console.log(`[docx_parser] Total entries parsed: ${entries.length}`);
  return entries;
}


// ══════════════════════════════════════════════════════════════
// PDF PARSER (zlib stream extraction — same approach as Python)
// ══════════════════════════════════════════════════════════════

function parsePdf(fileBuffer) {
  const { inflateSync } = require('zlib');
  const entries = [];
  let extractedText = '';

  try {
    const bufStr = fileBuffer.toString('latin1');

    // Extract all stream objects
    const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
    let streamMatch;

    while ((streamMatch = streamRegex.exec(bufStr)) !== null) {
      const rawData = Buffer.from(streamMatch[1], 'latin1');

      let decompressed = null;
      try {
        decompressed = inflateSync(rawData);
      } catch {
        try {
          decompressed = inflateSync(rawData, { windowBits: -15 });
        } catch {
          decompressed = rawData;
        }
      }

      if (decompressed) {
        const text = decompressed.toString('utf-8');

        // Extract text from Tj operators (single string)
        const tjRegex = /\((.*?)\)\s*Tj/g;
        let tjMatch;
        const tjParts = [];
        while ((tjMatch = tjRegex.exec(text)) !== null) {
          tjParts.push(tjMatch[1]);
        }
        if (tjParts.length) {
          extractedText += tjParts.join(' ') + '\n';
        }

        // Extract text from TJ arrays
        const tjArrayRegex = /\[(.*?)\]\s*TJ/g;
        let arrMatch;
        while ((arrMatch = tjArrayRegex.exec(text)) !== null) {
          const subRegex = /\((.*?)\)/g;
          let subMatch;
          const parts = [];
          while ((subMatch = subRegex.exec(arrMatch[1])) !== null) {
            parts.push(subMatch[1]);
          }
          if (parts.length) {
            extractedText += parts.join('') + ' ';
          }
        }
      }
    }
  } catch (e) {
    console.error('[pdf_parser] Stream parse error:', e.message);
  }

  if (!extractedText.trim()) return [];

  // Parse extracted text line by line
  const lines = extractedText.split('\n').map(ln => ln.trim()).filter(ln => ln);
  let currentDay = null;
  let periodCounter = 0;

  for (const line of lines) {
    const foundDay = DAYS.find(d => line.toLowerCase().includes(d.toLowerCase()));
    if (foundDay) {
      currentDay = foundDay;
      periodCounter = 0;
      continue;
    }

    if (!currentDay) continue;

    const timeMatch = line.match(/(\d{1,2}:\d{2})/);
    if (timeMatch || line.length > 4) {
      const isLab = isLabContent(line);
      const slotInfo = timeMatch ? findPeriodInfo(timeMatch[1]) : null;
      const parsed = parseCellToEntries(line);

      for (const p of parsed) {
        entries.push(buildEntry({
          day: currentDay,
          period: slotInfo ? slotInfo.period : (periodCounter % 6),
          startTime: slotInfo ? slotInfo.start : null,
          endTime: slotInfo ? slotInfo.end : null,
          subject: p.subject.slice(0, 50),
          subjectCode: p.subject_code,
          classType: isLab ? 'practical' : p.class_type,
          batch: p.batch,
          faculty: p.faculty,
          room: p.room,
        }));
        periodCounter++;
      }
    }
  }

  return entries;
}


// ══════════════════════════════════════════════════════════════
// RAW TEXT PARSER
// ══════════════════════════════════════════════════════════════

function parseRawText(text) {
  const entries = [];
  const lines = text.split('\n').map(ln => ln.trim()).filter(ln => ln);

  let currentDay = null;
  let periodCounter = 0;

  for (const line of lines) {
    const foundDay = DAYS.find(d => line.toLowerCase().includes(d.toLowerCase()));
    if (foundDay) {
      currentDay = foundDay;
      periodCounter = 0;
      continue;
    }

    if (!currentDay) continue;

    const timeMatch = line.match(/(\d{1,2}:\d{2})/);
    if (timeMatch || line.length > 4) {
      const isLab = isLabContent(line);
      let startTimeVal = null;
      if (timeMatch) {
        const parts = timeMatch[1].split(':');
        startTimeVal = `${parts[0].padStart(2, '0')}:${parts[1]}:00`;
      }

      const parsed = parseCellToEntries(line);
      for (const p of parsed) {
        entries.push({
          day: currentDay,
          period: periodCounter % 6,
          start_time: startTimeVal,
          end_time: null,
          subject: p.subject.slice(0, 50),
          subject_code: p.subject_code || null,
          class_type: isLab ? 'practical' : p.class_type || 'theory',
          batch: p.batch || 'ALL',
          faculty: p.faculty || null,
          room: p.room || null,
        });
        periodCounter++;
      }
    }
  }

  return entries;
}


// ══════════════════════════════════════════════════════════════
// HELPER: Day column detection (exact match with Python)
// ══════════════════════════════════════════════════════════════

function findDayColumnsFlexible(headerCells) {
  const mapping = {};
  for (let colIdx = 0; colIdx < headerCells.length; colIdx++) {
    const text = (headerCells[colIdx] || '').trim().toUpperCase();
    if (!text) continue;
    for (const [alias, dayName] of Object.entries(DAY_ALIASES)) {
      // Word boundary check to avoid false matches (e.g., THURSDAY matching TUE)
      const regex = new RegExp(`\\b${alias}\\b`);
      if (regex.test(text)) {
        mapping[colIdx] = dayName;
        break;
      }
    }
  }
  return mapping;
}


// ══════════════════════════════════════════════════════════════
// SCORING (exact match with Python calculate_parsing_score)
// ══════════════════════════════════════════════════════════════

function calculateParsingScore(entry) {
  let score = 0;

  // Subject: 20 pts
  const subject = (entry.subject || '').trim();
  if (subject && subject.length > 2) score += 20;

  // Subject code: 15 pts
  const subjectCode = (entry.subject_code || '').trim();
  if (subjectCode && /^[A-Z]{1,3}\d{3,4}[A-Z]{0,2}$/.test(subjectCode)) score += 15;

  // Faculty: 15 pts
  const faculty = (entry.faculty || '').trim();
  if (faculty && faculty.length >= 2) score += 15;

  // Room: 15 pts
  const room = (entry.room || '').trim();
  if (room && room.length >= 1) score += 15;

  // Day: 10 pts
  const day = (entry.day || '').trim();
  if (VALID_DAYS.has(day)) score += 10;

  // Start & end time: 10 pts (5 each)
  if (entry.start_time) score += 5;
  if (entry.end_time) score += 5;

  // Batch: 5 pts
  const batch = (entry.batch || '').trim();
  if (batch) score += 5;

  // Class type: 5 pts
  const classType = (entry.class_type || '').trim().toLowerCase();
  if (VALID_CLASS_TYPES.has(classType)) score += 5;

  // Period: 5 pts
  const period = entry.period;
  if (typeof period === 'number' && period >= 0 && period <= 5) score += 5;

  return Math.min(score, 100);
}

function calculateOverallScore(entries) {
  if (!entries.length) return 0;
  const total = entries.reduce((sum, e) => sum + (e.parsing_score || 0), 0);
  return Math.round((total / entries.length) * 10) / 10;
}


// ══════════════════════════════════════════════════════════════
// MAIN ENTRY POINT
// ══════════════════════════════════════════════════════════════

/**
 * Process a timetable file buffer and return structured entries.
 *
 * @param {Buffer} fileBuffer - The raw file bytes
 * @param {string} filename - Original filename (for extension detection)
 * @param {string} program - Program name (e.g. "B.Pharm")
 * @param {number} semester - Semester number
 * @param {string|null} division - Division (e.g. "A", "B") or null
 * @returns {{ success: boolean, entries: Array, count: number, parser: string, overall_parsing_score: number }}
 */
export function processTimetableFile(fileBuffer, filename, program, semester, division = null) {
  const ext = filename.includes('.') ? filename.split('.').pop().toLowerCase() : '';
  let entries = [];
  let parserUsed = 'unknown';

  console.log(`[parser] Processing file: ${filename} (ext: ${ext})`);

  // ── Strategy 1: JSON format ──
  try {
    const text = fileBuffer.toString('utf-8');
    const jsonContent = JSON.parse(text);

    if (jsonContent && typeof jsonContent === 'object' && Array.isArray(jsonContent.slots)) {
      entries = jsonContent.slots.filter(s => s && typeof s === 'object').map(s => ({
        day: s.day || null,
        period: s.period || 0,
        start_time: s.start_time || null,
        end_time: s.end_time || null,
        subject: s.subject || 'Untitled',
        subject_code: s.code || s.subject_code || null,
        class_type: s.type || s.class_type || 'theory',
        batch: s.batch || 'ALL',
        faculty: s.faculty || null,
        room: s.room || null,
      }));
      if (entries.length) parserUsed = 'json';
    } else if (Array.isArray(jsonContent)) {
      entries = jsonContent.filter(s => s && typeof s === 'object').map(s => ({
        day: s.day || 'Monday',
        period: s.period || 0,
        start_time: s.start_time || null,
        end_time: s.end_time || null,
        subject: s.subject || 'Untitled',
        subject_code: s.subject_code || s.code || null,
        class_type: s.class_type || s.type || 'theory',
        batch: s.batch || 'ALL',
        faculty: s.faculty || null,
        room: s.room || null,
      }));
      if (entries.length) parserUsed = 'json';
    }
  } catch {
    // Not JSON, continue to next strategy
  }

  // ── Strategy 2: DOCX table extraction ──
  if (!entries.length && (ext === 'docx' || !ext)) {
    try {
      console.log('[parser] Trying DOCX parser...');
      entries = parseDocxFromBuffer(fileBuffer);
      if (entries.length) parserUsed = 'docx';
    } catch (e) {
      console.error('[parser] DOCX parsing error:', e.message);
    }
  }

  // ── Strategy 3: PDF stream extraction ──
  if (!entries.length && (ext === 'pdf' || !ext)) {
    try {
      console.log('[parser] Trying PDF parser...');
      entries = parsePdf(fileBuffer);
      if (entries.length) parserUsed = 'pdf';
    } catch (e) {
      console.error('[parser] PDF parsing error:', e.message);
    }
  }

  // ── Strategy 4: Raw text fallback ──
  if (!entries.length) {
    try {
      console.log('[parser] Trying raw text parser...');
      const text = fileBuffer.toString('utf-8');
      entries = parseRawText(text);
      if (entries.length) parserUsed = 'text';
    } catch (e) {
      console.error('[parser] Text parsing error:', e.message);
    }
  }

  console.log(`[parser] Parser used: ${parserUsed}, raw entries: ${entries.length}`);

  // ── Deduplicate entries ──
  const seen = new Set();
  const unique = [];
  for (const e of entries) {
    const key = `${e.day}|${e.period}|${e.start_time}|${e.subject}|${e.batch}|${e.faculty}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(e);
    }
  }
  entries = unique;

  // ── Calculate parsing scores ──
  for (const e of entries) {
    e.parsing_score = calculateParsingScore(e);
  }

  const overallScore = calculateOverallScore(entries);

  console.log(`[parser] Final: ${entries.length} entries, overall score: ${overallScore}%`);

  return {
    success: entries.length > 0,
    entries,
    count: entries.length,
    parser: parserUsed,
    overall_parsing_score: overallScore,
  };
}
