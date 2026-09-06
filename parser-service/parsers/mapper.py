"""
mapper.py — Shared utilities for mapping raw timetable grid data into
structured slot entries that match the Supabase timetable_entries schema.

Output shape per entry:
{
    "day": "Monday",
    "period": 0,
    "start_time": "09:30:00",
    "end_time": "10:30:00",
    "subject": "HAPP-I",
    "subject_code": "BP101T",
    "class_type": "theory",
    "batch": "ALL",
    "faculty": "FC:KVT",       ← FC: prefix for faculty codes (stripped in UI)
    "room": "309"
}

Faculty Naming Convention:
- Full names with titles: stored as-is → "Ms. Jahnavi Soni"
- Short faculty codes: stored with FC: prefix → "FC:KVT", "FC:AAN"
- The FC: prefix is NEVER shown in the UI — display layer strips it.
- This prefix lets the system distinguish faculty codes from subject codes.
"""

from __future__ import annotations

import re
from typing import List, Optional

# ── Period definitions ──
PERIOD_MAP = [
    {"period": 0, "start": "09:30:00", "end": "10:30:00", "markers": ["09:30", "9:30"]},
    {"period": 1, "start": "10:30:00", "end": "11:30:00", "markers": ["10:30"]},
    {"period": 2, "start": "11:30:00", "end": "12:30:00", "markers": ["11:30"]},
    # Recess: 12:30 – 13:30
    {"period": 3, "start": "13:30:00", "end": "14:30:00", "markers": ["13:30", "01:30", "1:30"]},
    {"period": 4, "start": "14:30:00", "end": "15:30:00", "markers": ["14:30", "02:30", "2:30"]},
    {"period": 5, "start": "15:30:00", "end": "16:25:00", "markers": ["15:30", "03:30", "3:30"]},
]

DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

# Day aliases for flexible detection (used by docx_parser and pdf_parser)
DAY_ALIASES = {
    "MONDAY": "Monday", "MON": "Monday",
    "TUESDAY": "Tuesday", "TUE": "Tuesday", "TUES": "Tuesday",
    "WEDNESDAY": "Wednesday", "WED": "Wednesday",
    "THURSDAY": "Thursday", "THU": "Thursday", "THUR": "Thursday", "THURS": "Thursday",
    "FRIDAY": "Friday", "FRI": "Friday",
    "SATURDAY": "Saturday", "SAT": "Saturday",
}

# ── Regex patterns ──
_RE_BATCH = re.compile(r"(?:BATCH|Batch)\s*:?\s*([A-D0-9])", re.IGNORECASE)

# Room with keyword prefix (e.g., "Room 302", "Lab 201")
_RE_ROOM_PREFIXED = re.compile(
    r"(?:ROOM|LAB|HALL)\s*[:\-]?\s*([0-9]{3}\s*[A-Z]?|PSH)\b", re.IGNORECASE
)

# Faculty with formal title (e.g., "Ms. Jahnavi Soni", "Dr. Smith")
_RE_FACULTY_TITLED = re.compile(
    r"(?:Dr\.|Prof\.|Mr\.|Ms\.|Mrs\.)\s+([A-Za-z.]+(?:\s+[A-Za-z.]+){0,3})", re.IGNORECASE
)

# Subject code — pharmacy-specific: BP101T, BP706PS, MP101T, PD501, etc.
# Matches 1-3 uppercase letter program prefix + 3-4 digit number + optional 1-2 letter suffix
_RE_SUBJECT_CODE = re.compile(r"\b([A-Z]{1,3}[0-9]{3,4}[A-Z]{0,2})\b")

# Lines that are ONLY metadata (faculty, room, batch) and not subject names
_RE_PURE_FACULTY = re.compile(r"^\s*(?:Dr\.|Prof\.|Mr\.|Ms\.|Mrs\.)\s+[A-Za-z.\s]+$", re.IGNORECASE)
_RE_PURE_ROOM = re.compile(r"^\s*(?:ROOM|LAB|HALL)\s*[:\-]?\s*[0-9A-Z]+\s*$", re.IGNORECASE)
_RE_PURE_BATCH = re.compile(r"^\s*(?:BATCH|Batch)\s*:?\s*[A-D0-9]\s*$", re.IGNORECASE)

# Compact format: detect trailing "FACULTY_CODE ROOM_NO [BATCH_A-D]" pattern
# e.g., "PM KVT 309" → subject="PM", faculty="FC:KVT", room="309"
# e.g., "HPCS NMV 408 Batch C" → subject="HPCS", faculty="FC:NMV", room="408", batch="C"
_RE_COMPACT_TRAILING = re.compile(
    r"^(.+?)\s+([A-Z]{2,5})\s+(\d{3}\s*[A-Z]?|PSH)(?:\s+(?:BATCH|Batch)\s*:?\s*([A-D0-9]))?$",
    re.IGNORECASE
)


def _normalize_time(time_text: str) -> str:
    """
    Normalize time text to a consistent format for matching.
    Handles: "9.30", "9:30 AM", "09:30-10:30", "0930", "9:30 am - 10:30 am"
    Returns cleaned string with only digits and colons.
    """
    if not time_text:
        return ""
    t = time_text.strip()
    # Replace dots with colons: "9.30" → "9:30"
    t = t.replace(".", ":")
    # Remove AM/PM
    t = re.sub(r"\s*(am|pm|AM|PM)\s*", "", t)
    # Remove extra whitespace
    t = re.sub(r"\s+", "", t)
    return t


def find_period_info(time_text: str) -> Optional[dict]:
    """
    Match a time-cell string to the corresponding period info.
    Handles various time formats: "9:30-10:30", "9.30", "09:30", "9:30 AM", "2:25 - 3:20", "3:20 - 4:15", etc.
    Returns None for recess times (12:30-13:29) so callers skip those rows.
    """
    if not time_text:
        return None

    # BUG-1 FIX: Reject recess window times (12:30 – 13:29).
    # Without this guard, "12:30" falls through to the minute-based heuristic
    # and gets incorrectly mapped to a teaching period, creating phantom entries.
    upper = time_text.strip().upper()
    if "RECESS" in upper or "BREAK" in upper or "LUNCH" in upper:
        return None

    clean = _normalize_time(time_text)

    # Check for recess-range times before matching teaching periods.
    # Extract the FIRST time value to check if it's in the recess window.
    _recess_match = re.search(r"(\d{1,2})[:.](\d{2})", time_text)
    if _recess_match:
        _rh, _rm = int(_recess_match.group(1)), int(_recess_match.group(2))
        # Normalize 12-hour to 24-hour only for small values (1-5 that are PM)
        if 1 <= _rh <= 5 and ("pm" in time_text.lower() or _rh < 9):
            _rh += 12
        _rmins = _rh * 60 + _rm
        # 12:30 (750) to 13:29 (809) is the recess window — reject it
        if 750 <= _rmins <= 809:
            return None

    # Check for period 3 shorthand: "1 - 2:30", "1 to 2:30", "1 2:30 -", "01:30 - 02:30"
    if re.search(r"\b(?:0?1|1:30)\b.*?\b(?:0?2|2:30)\b", time_text, re.IGNORECASE):
        return {"period": 3, "start": "13:30:00", "end": "14:30:00"}

    for p in PERIOD_MAP:
        for marker in p["markers"]:
            if marker in clean:
                return {"period": p["period"], "start": p["start"], "end": p["end"]}

    # Try matching raw digits or HH:MM / H:MM patterns
    match = re.search(r"(\d{1,2})[:.](\d{2})", time_text)
    if match:
        h, m = int(match.group(1)), int(match.group(2))
        if 1 <= h <= 5 and ("pm" in time_text.lower() or h < 9):
            h += 12
        mins = h * 60 + m
        if 540 <= mins <= 614:      # ~09:00 - 10:14
            return {"period": 0, "start": "09:30:00", "end": "10:30:00"}
        elif 615 <= mins <= 674:    # ~10:15 - 11:14
            return {"period": 1, "start": "10:30:00", "end": "11:30:00"}
        elif 675 <= mins <= 749:    # ~11:15 - 12:29
            return {"period": 2, "start": "11:30:00", "end": "12:30:00"}
        # 750-809 is recess — already rejected above
        elif 810 <= mins <= 854:    # ~13:30 - 14:14
            return {"period": 3, "start": "13:30:00", "end": "14:30:00"}
        elif 855 <= mins <= 914:    # ~14:15 - 15:14 (e.g. 14:25 / 2:25)
            return {"period": 4, "start": "14:30:00", "end": "15:30:00"}
        elif 915 <= mins <= 1020:   # ~15:15 - 17:00 (e.g. 15:20 / 3:20)
            return {"period": 5, "start": "15:30:00", "end": "16:25:00"}

    # Fallback raw 4-digit format like "0930"
    digits = re.sub(r"[^0-9]", "", time_text)
    if len(digits) >= 4:
        h, m = int(digits[:2]), int(digits[2:4])
        for p in PERIOD_MAP:
            ps = p["start"].split(":")
            if int(ps[0]) == h and int(ps[1]) == m:
                return {"period": p["period"], "start": p["start"], "end": p["end"]}

    return None


def is_lab_content(text: str) -> bool:
    """Check if cell content indicates a practical/lab session."""
    upper = text.upper()
    return any(kw in upper for kw in ["BATCH", "LAB", "PRACTICAL"])


def _is_metadata_line(line: str) -> bool:
    """Check if a line is purely metadata (faculty/room/batch), not a subject."""
    return bool(
        _RE_PURE_FACULTY.match(line)
        or _RE_PURE_ROOM.match(line)
        or _RE_PURE_BATCH.match(line)
    )


def _extract_compact_format(line: str) -> Optional[dict]:
    """
    Try to parse a compact-format line like "PM KVT 309" or "HPCS NMV 408 Batch C".
    Returns dict with subject, faculty (FC:-prefixed), room, batch or None.
    """
    match = _RE_COMPACT_TRAILING.match(line.strip())
    if not match:
        return None

    subject_part = match.group(1).strip()
    faculty_code = match.group(2).strip()
    room_part = match.group(3).strip()
    batch_part = match.group(4).strip().upper() if match.group(4) else None

    # Validate: faculty_code should be 2-5 uppercase letters, not a known metadata keyword
    if not faculty_code.isalpha():
        return None
    if faculty_code.upper() in {"ROOM", "LAB", "HALL", "BATCH", "DIV", "DEPT", "SEM", "SEC"}:
        return None

    # Validate room part (3 digits + optional letter, or PSH)
    if not re.match(r"^\d{3}\s*[A-Z]?$", room_part, re.IGNORECASE) and room_part.upper() != "PSH":
        return None

    return {
        "subject": subject_part,
        "faculty": f"FC:{faculty_code}",
        "room": room_part,
        "batch": batch_part,
    }


def _extract_metadata(line: str) -> dict:
    """Extract faculty, room, batch, subject_code from a single line."""
    result = {"faculty": None, "room": None, "batch": None, "subject_code": None}

    # 1. Try formal faculty title (Dr./Ms./Prof.)
    fac = _RE_FACULTY_TITLED.search(line)
    if fac:
        result["faculty"] = fac.group(0).strip()

    # 2. Try prefixed room (Room 302, Lab 201)
    room = _RE_ROOM_PREFIXED.search(line)
    if room:
        result["room"] = room.group(1).strip()

    # 3. Batch detection
    batch = _RE_BATCH.search(line)
    if batch:
        result["batch"] = batch.group(1).upper()

    # 4. Subject code (pharmacy-specific: BP101T, MP201P, PD501, etc.)
    code = _RE_SUBJECT_CODE.search(line)
    if code:
        candidate = code.group(1).strip()
        # Only accept if it starts with a known program prefix pattern
        # and has at least 1 letter + 3 digits
        if re.match(r"^[A-Z]{1,3}\d{3}", candidate):
            result["subject_code"] = candidate

    return result


# Patterns that should be fully skipped (produce 0 entries)
_SKIP_PATTERNS = [
    "RECESS", "BREAK", "LUNCH",
    "SIGN OF HOD", "SIGN",
    "CLASSROOM NO",
    "LAB/ TUTORIAL LOCATION",
    "SUBJECT CODE", "SUBJECT INITIALS", "STAFF INITIALS", "STAFF NAME",
    "STAFF EMAIL", "MFT / FACULTY",
]

# Patterns that should produce a self_study entry (not empty)
_SELF_STUDY_PATTERNS = [
    "ASSIGNMENT", "ASSIGNMENT/LIBRARY", "ASSIGNMENT / LIBRARY",
    "WEEKLY TEST", "WEEKLY TESTS",
    "REMEDIAL", "REMEDIAL CLASS",
    "SPORTS", "CO-CURRICULAR",
    "FREE", "FREE PERIOD",
]


def _classify_filler_cell(text: str) -> Optional[str]:
    """Classify a cell as 'skip' (produce nothing), 'self_study' (produce a self_study entry),
    or None (not a filler — parse normally)."""
    upper = text.strip().upper()
    # Remove VAC/SWAYAM/NPTEL suffixes for classification purposes
    clean_for_check = re.sub(r"[/\s]*VAC\*?[/\s]*SWAYAM[/\s]*NPTEL.*$", "", upper, flags=re.IGNORECASE).strip()
    cleaned = re.sub(r"[^A-Z0-9/ ]", "", clean_for_check).strip()
    
    for pat in _SKIP_PATTERNS:
        if upper == pat or upper.startswith(pat + " ") or cleaned == pat:
            return "skip"
    for pat in _SELF_STUDY_PATTERNS:
        if upper == pat or upper.startswith(pat + " ") or upper.endswith(" " + pat) or cleaned == pat:
            return "self_study"
        # Also check the VAC-stripped version
        if clean_for_check == pat or clean_for_check.startswith(pat + " ") or clean_for_check.endswith(" " + pat):
            return "self_study"
    # Pure VAC/SWAYAM/NPTEL-only cell
    vac_only = re.sub(r"[^A-Z0-9/ ]", "", upper).strip()
    if vac_only in ("VAC SWAYAM NPTEL", "VAC/ SWAYAM/NPTEL", "VAC /SWAYAM/NPTEL"):
        return "self_study"
    return None


def _normalize_filler_subject(text: str) -> str:
    """Normalize filler cell text to a clean subject name for self_study entries."""
    upper = text.strip().upper()
    # Strip trailing VAC/SWAYAM/NPTEL suffix
    cleaned = re.sub(r"[/\s]*VAC\*?[/\s]*(?:SWAYAM)?[/\s]*(?:NPTEL)?\s*$", "", upper, flags=re.IGNORECASE).strip()
    cleaned = re.sub(r"[/\s]+$", "", cleaned).strip()
    if not cleaned:
        return "VAC/SWAYAM/NPTEL"
    # Normalize common patterns
    norm_map = {
        "ASSIGNMENT": "Assignment/Library",
        "ASSIGNMENT/LIBRARY": "Assignment/Library",
        "ASSIGNMENT / LIBRARY": "Assignment/Library",
        "ASSIGNMENT /LIBRARY": "Assignment/Library",
        "ASSIGNMENT /LIBRARY/ REMEDIAL": "Assignment/Library",
        "ASSIGNMENT /LIBRARY/REMEDIAL": "Assignment/Library",
        "WEEKLY TEST": "Weekly Test",
        "WEEKLY TESTS": "Weekly Test",
        "REMEDIAL": "Remedial",
        "REMEDIAL CLASS": "Remedial",
        "SPORTS": "Sports",
        "CO-CURRICULAR": "Co-Curricular",
        "FREE": "Free Period",
        "FREE PERIOD": "Free Period",
    }
    # Try exact match first, then prefix match
    for pat, label in norm_map.items():
        if cleaned == pat or cleaned.startswith(pat):
            return label
    return text.strip()


def _strip_subject_code(subject: str, subject_code: Optional[str] = None) -> str:
    """Remove parenthesized subject codes from subject names.
    'HAPP-I (BP101T)' -> 'HAPP-I'
    Also strips any detected subject code even without parens if it's at the end."""
    if not subject:
        return subject
    # Strip (CODE) pattern
    result = re.sub(r"\s*\([A-Z]{1,3}\d{3,4}[A-Z]{0,2}\)", "", subject).strip()
    return result if result else subject


def parse_cell_to_entries(cell_text: str, doc_metadata: Optional[dict] = None) -> List[dict]:
    """
    Parse a timetable cell's full text into one or more logical entry blocks.
    
    Args:
        cell_text: Raw cell text from the timetable document.
        doc_metadata: Optional metadata extracted from the document's legend table.
            Keys: 'faculty_map' (initials→full name), 'subject_map' (initials→code),
            'classroom' (default theory room), 'lab_rooms' (list of lab rooms).
    """
    if not cell_text or len(cell_text.strip()) < 2:
        return []

    clean = cell_text.strip()
    if "RECESS" in clean.upper():
        return []

    # Classify filler cells: skip, self_study, or parse normally
    filler_type = _classify_filler_cell(clean)
    if filler_type == "skip":
        return []
    if filler_type == "self_study":
        return [{
            "subject": _normalize_filler_subject(clean),
            "subject_code": None,
            "class_type": "self_study",
            "batch": "ALL",
            "faculty": None,
            "room": None,
        }]

    lines = [ln.strip() for ln in clean.split("\n") if ln.strip()]
    if not lines:
        return []

    is_lab = is_lab_content(clean)

    # ── FAST PATH: 2-line university format (most common) ──
    # Theory: ["SUBJECT", "FACULTY_CODE"]
    # Practical: ["SUBJECT BATCH X", "FACULTY_CODE ROOM"]
    if len(lines) == 2:
        line1, line2 = lines[0], lines[1]
        
        # Check if line1 has a batch indicator: "GP BATCH A" or "PIAC BATCH B"
        batch_in_line1 = re.search(r"\bBATCH\s*:?\s*([A-D0-9])\b", line1, re.IGNORECASE)
        
        # Check if line2 is "FACULTY_CODE ROOM" pattern: "JHB 311" or "HMP 201 A"
        line2_compact = re.match(r"^([A-Z]{2,5})\s+(\d{3}\s*[A-Z]?)$", line2.strip())
        
        # Check if line2 is just a faculty code: "JVS", "BKS", "RR"
        # Also support multi-faculty slash: "APP/RKS", "JHB/SJP"
        line2_faculty_only = re.match(r"^([A-Z]{2,5}(?:\s*/\s*[A-Z]{2,5})*)$", line2.strip())
        
        if batch_in_line1 and line2_compact:
            # PRACTICAL: "GP BATCH A" + "JHB 311"
            subject = re.sub(r"\s*BATCH\s*:?\s*[A-D0-9]\s*", " ", line1, flags=re.IGNORECASE).strip()
            batch = batch_in_line1.group(1).upper()
            faculty_code = line2_compact.group(1)
            room = line2_compact.group(2).strip()
            
            code_match = _RE_SUBJECT_CODE.search(subject)
            subject_code = code_match.group(1) if code_match else None
            subject = _strip_subject_code(subject, subject_code)  # BUG-3 FIX
            
            return [{
                "subject": subject[:80],
                "subject_code": subject_code,
                "class_type": "practical",
                "batch": batch,
                "faculty": f"FC:{faculty_code}",
                "room": room,
            }]
        
        elif line2_faculty_only and not batch_in_line1:
            # THEORY: "HAPP I" + "JVS"
            subject = line1.strip()
            faculty_code = line2_faculty_only.group(1)
            
            paren_code = re.search(r"\(([A-Z]{1,3}\d{3,4}[A-Z]{0,2})\)", subject)
            code_match = _RE_SUBJECT_CODE.search(subject) if not paren_code else None
            subject_code = (paren_code.group(1) if paren_code 
                          else code_match.group(1) if code_match else None)
            
            subject = _strip_subject_code(subject, subject_code)  # BUG-3 FIX
            
            return [{
                "subject": subject[:80],
                "subject_code": subject_code,
                "class_type": "practical" if is_lab else "theory",
                "batch": "ALL",
                "faculty": f"FC:{faculty_code}",
                "room": None,
            }]
        
        elif line2_compact and not batch_in_line1:
            # THEORY with room: "SUBJECT" + "FACULTY ROOM"
            subject = line1.strip()
            faculty_code = line2_compact.group(1)
            room = line2_compact.group(2).strip()
            
            code_match = _RE_SUBJECT_CODE.search(subject)
            subject_code = code_match.group(1) if code_match else None
            subject = _strip_subject_code(subject, subject_code)  # BUG-3 FIX
            
            return [{
                "subject": subject[:80],
                "subject_code": subject_code,
                "class_type": "practical" if is_lab else "theory",
                "batch": "ALL",
                "faculty": f"FC:{faculty_code}",
                "room": room,
            }]

    # ── SATURDAY / TUTORIAL CELL HANDLER ──
    # Handles cells like: "PP I (T)\nAPP /\nVAC*/ SWAYAM/NPTEL"
    # or "PM (T)\nJHB /\nVAC*/ SWAYAM/NPTEL"
    # or "POC II (T)\nNSP /\nVAC*/ SWAYAM/NPTEL"
    # These contain: SUBJECT (T) / FACULTY / VAC suffix spread across lines
    joined_text = " ".join(lines)
    if "VAC" in joined_text.upper() and ("SWAYAM" in joined_text.upper() or "NPTEL" in joined_text.upper()):
        # Try to extract: SUBJECT (T) FACULTY / VAC*/ SWAYAM/NPTEL
        # Step 1: Strip VAC/SWAYAM/NPTEL suffix from joined text
        core = re.sub(r"[/\s]*VAC\*?[/\s]*SWAYAM[/\s]*/?\s*NPTEL.*$", "", joined_text, flags=re.IGNORECASE).strip()
        core = re.sub(r"[/\s]+$", "", core).strip()
        
        # Step 2: Extract tutorial marker (T)
        has_tutorial = bool(re.search(r"\(T\)", core, re.IGNORECASE))
        core = re.sub(r"\s*\(T\)\s*", " ", core, flags=re.IGNORECASE).strip()
        
        # Step 3: Try to find faculty code at the end: "PP I APP" or "PM JHB"
        # Pattern: SUBJECT FACULTY_CODE where FACULTY_CODE is 2-5 uppercase letters
        fac_match = re.match(r"^(.+?)\s+([A-Z]{2,5}(?:\s*/\s*[A-Z]{2,5})*)$", core)
        if fac_match:
            subject = fac_match.group(1).strip()
            faculty_code = fac_match.group(2).strip()
            
            code_match = _RE_SUBJECT_CODE.search(subject)
            subject_code = code_match.group(1) if code_match else None
            subject = _strip_subject_code(subject, subject_code)
            
            # Resolve faculty from doc_metadata if available
            faculty_display = f"FC:{faculty_code}"
            if doc_metadata and "faculty_map" in doc_metadata:
                resolved = doc_metadata["faculty_map"].get(faculty_code)
                if resolved:
                    faculty_display = resolved
            
            # Resolve subject_code from doc_metadata if available
            if not subject_code and doc_metadata and "subject_map" in doc_metadata:
                subject_code = doc_metadata["subject_map"].get(subject.strip())
            
            return [{
                "subject": subject[:80],
                "subject_code": subject_code,
                "class_type": "theory",
                "batch": "ALL",
                "faculty": faculty_display,
                "room": None,
            }]
        else:
            # No faculty found, just store subject with VAC suffix info
            subject = core.strip() if core else joined_text.strip()
            code_match = _RE_SUBJECT_CODE.search(subject)
            subject_code = code_match.group(1) if code_match else None
            subject = _strip_subject_code(subject, subject_code)
            
            return [{
                "subject": subject[:80],
                "subject_code": subject_code,
                "class_type": "theory",
                "batch": "ALL",
                "faculty": None,
                "room": None,
            }]

    # ── MULTI-LINE / COMPLEX FORMAT (3+ lines or unmatched 2-line) ──
    # BUG-2 FIX: Properly split multi-batch lab cells into separate blocks.
    # A cell like "GP BATCH A\nJHB 311\nPCG BATCH B\nSMP 401 B" must produce
    # two entries with batch=A and batch=B respectively.
    blocks = []
    current_block = []

    for line in lines:
        batch_match = _RE_BATCH.search(line)
        if batch_match and current_block:
            # New batch starts → flush previous block
            blocks.append(current_block)
            current_block = [line]
        else:
            current_block.append(line)

    if current_block:
        blocks.append(current_block)

    entries = []
    for block_lines in blocks:
        subject_parts = []
        faculty = None
        room = None
        batch = "ALL"
        subject_code = None

        # BUG-2 FIX: Extract batch from any line in this block that contains BATCH.
        # This ensures batch info isn't lost even in the generic multi-line path.
        for bl in block_lines:
            bm = _RE_BATCH.search(bl)
            if bm:
                batch = bm.group(1).upper()
                break

        # Try joining all lines and testing compact format
        # Strip BATCH patterns from the joined text so they don't pollute the subject
        joined = " ".join(block_lines)
        joined_clean = re.sub(r"\s*BATCH\s*:?\s*[A-D0-9]\s*:?\s*", " ", joined, flags=re.IGNORECASE).strip()
        compact = _extract_compact_format(joined_clean)
        if compact:
            # Use batch from block extraction above, compact batch as fallback
            final_batch = batch if batch != "ALL" else (compact.get("batch") or "ALL")
            subject = _strip_subject_code(compact["subject"])
            subject = re.sub(r"\s+", " ", subject).strip()
            entries.append({
                "subject": subject[:80],
                "subject_code": None,
                "class_type": "practical" if is_lab else "theory",
                "batch": final_batch,
                "faculty": compact["faculty"],
                "room": compact["room"],
            })
            continue

        for line in block_lines:
            # Try compact format on individual line
            compact = _extract_compact_format(line)
            if compact:
                if compact["subject"] and len(compact["subject"]) > 1:
                    subject_parts.append(compact["subject"])
                if compact["faculty"] and not faculty:
                    faculty = compact["faculty"]
                if compact["room"] and not room:
                    room = compact["room"]
                if compact.get("batch") and compact["batch"]:
                    batch = compact["batch"]
                code_match = _RE_SUBJECT_CODE.search(compact["subject"])
                if code_match and not subject_code:
                    subject_code = code_match.group(1)
                continue

            # Formal format parsing
            meta = _extract_metadata(line)

            if meta["faculty"] and not faculty:
                faculty = meta["faculty"]
            if meta["room"] and not room:
                room = meta["room"]
            if meta["batch"]:
                batch = meta["batch"]
            if meta["subject_code"] and not subject_code:
                subject_code = meta["subject_code"]

            # If not purely metadata, it contributes to subject name
            if not _is_metadata_line(line):
                subject_line = re.sub(
                    r"(?:BATCH|Batch)\s*:?\s*[A-D0-9]\s*:?\s*", "", line, flags=re.IGNORECASE
                ).strip()
                if subject_line and len(subject_line) > 1:
                    subject_parts.append(subject_line)

        subject = " ".join(subject_parts).strip() if subject_parts else block_lines[0]
        subject = re.sub(r"\s+", " ", subject).strip()

        # BUG-3 FIX: Strip parenthesized subject codes from subject name in all paths
        subject = _strip_subject_code(subject, subject_code)

        if not subject or len(subject) < 2:
            continue

        # BUG-2 FIX: For lab cells, use the extracted batch (not forced "ALL").
        # For non-lab cells, batch should be "ALL" unless explicitly set.
        class_type = "practical" if is_lab else "theory"
        final_batch = batch if is_lab else (batch if batch != "ALL" else "ALL")

        entries.append({
            "subject": subject[:80],
            "subject_code": subject_code,
            "class_type": class_type,
            "batch": final_batch,
            "faculty": faculty,
            "room": room,
        })

    return entries


def parse_slot_content(content: str, is_lab: bool = False) -> Optional[dict]:
    """
    Legacy wrapper: parse a cell's text into a single entry dict.
    Uses parse_cell_to_entries internally and returns the first entry.
    """
    results = parse_cell_to_entries(content)
    if not results:
        return None
    return results[0]


def display_faculty(faculty: str) -> str:
    """
    Strip the FC: prefix from faculty codes for user-facing display.
    "FC:KVT" → "KVT", "Ms. Jahnavi Soni" → "Ms. Jahnavi Soni"
    """
    if not faculty:
        return ""
    if faculty.startswith("FC:"):
        return faculty[3:]
    return faculty


def build_entry(
    day: str,
    period: int,
    start_time: str,
    end_time: str,
    subject: str,
    class_type: str = "theory",
    batch: str = "ALL",
    faculty: Optional[str] = None,
    room: Optional[str] = None,
    subject_code: Optional[str] = None,
) -> dict:
    """Build a single timetable entry dict matching the Supabase schema."""
    return {
        "day": day,
        "period": period,
        "start_time": start_time,
        "end_time": end_time,
        "subject": subject,
        "subject_code": subject_code,
        "class_type": class_type,
        "batch": batch,
        "faculty": faculty,
        "room": room,
    }
