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

# Compact format: detect trailing "FACULTY_CODE ROOM_NO" pattern
# e.g., "PM KVT 309" → subject="PM", faculty="FC:KVT", room="309"
# e.g., "POC II AAN 201 A" → subject="POC II", faculty="FC:AAN", room="201 A"
_RE_COMPACT_TRAILING = re.compile(
    r"^(.+?)\s+([A-Z]{2,5})\s+(\d{3}\s*[A-Z]?|PSH)$"
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
    Handles various time formats: "9:30-10:30", "9.30", "09:30", "9:30 AM", etc.
    """
    if not time_text:
        return None
    clean = _normalize_time(time_text)
    for p in PERIOD_MAP:
        for marker in p["markers"]:
            if marker in clean:
                return {"period": p["period"], "start": p["start"], "end": p["end"]}
    # Also try matching raw 4-digit format like "0930"
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
    Try to parse a compact-format line like "PM KVT 309" or "POC II AAN 201 A".
    Returns dict with subject, faculty (FC:-prefixed), room, or None if not compact format.
    """
    match = _RE_COMPACT_TRAILING.match(line.strip())
    if not match:
        return None

    subject_part = match.group(1).strip()
    faculty_code = match.group(2).strip()
    room_part = match.group(3).strip()

    # Validate: faculty_code should be 2-5 uppercase letters, not a known subject abbreviation
    # Subject codes have digits (BP101T), faculty codes are pure letters (KVT, AAN)
    if not faculty_code.isalpha():
        return None

    # Don't match if room_part doesn't look like a room (3-digit number + optional letter)
    if not re.match(r"^\d{3}\s*[A-Z]?$", room_part):
        return None

    return {
        "subject": subject_part,
        "faculty": f"FC:{faculty_code}",
        "room": room_part,
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


def parse_cell_to_entries(cell_text: str) -> List[dict]:
    """
    Parse a timetable cell's full text into one or more logical entry blocks.

    Strategy:
    1. Split cell text into lines.
    2. Group lines into logical blocks (new block at each "Batch X" indicator).
    3. For each block, try two parsing approaches:
       a. Formal format: lines with "Dr./Ms." titles and "Room/Lab" keywords
       b. Compact format: "SUBJECT FACULTY_CODE ROOM_NO" on a single line
    4. Faculty codes get FC: prefix for differentiation from subject codes.
    5. Return a list of parsed entry dicts.

    Examples:
        "HAPP-I (BP101T)\\nMs. Jahnavi Soni\\nRoom 302" → 1 entry (formal)
        "PM KVT 309" → 1 entry (compact: subject=PM, faculty=FC:KVT, room=309)
        "Batch A: Pharma Chem Lab\\nDr. Smith\\nLab 201\\nBatch B: Pharm\\nMs. Patel" → 2 entries
    """
    if not cell_text or len(cell_text.strip()) < 2:
        return []

    clean = cell_text.strip()
    if "RECESS" in clean.upper():
        return []

    lines = [ln.strip() for ln in clean.split("\n") if ln.strip()]
    if not lines:
        return []

    is_lab = is_lab_content(clean)

    # ── Group lines into logical blocks ──
    blocks = []
    current_block = []

    for line in lines:
        batch_match = _RE_BATCH.search(line)
        if batch_match and current_block:
            blocks.append(current_block)
            current_block = [line]
        else:
            current_block.append(line)

    if current_block:
        blocks.append(current_block)

    # ── Parse each block ──
    entries = []
    for block_lines in blocks:
        subject_parts = []
        faculty = None
        room = None
        batch = "ALL"
        subject_code = None

        for line in block_lines:
            # ── Try compact format first ("PM KVT 309") ──
            compact = _extract_compact_format(line)
            if compact:
                if compact["subject"] and len(compact["subject"]) > 1:
                    subject_parts.append(compact["subject"])
                if compact["faculty"] and not faculty:
                    faculty = compact["faculty"]
                if compact["room"] and not room:
                    room = compact["room"]
                # Check if subject part contains a subject code
                code_match = _RE_SUBJECT_CODE.search(compact["subject"])
                if code_match and not subject_code:
                    subject_code = code_match.group(1)
                continue

            # ── Formal format parsing ──
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

        if not subject or len(subject) < 2:
            continue

        class_type = "practical" if is_lab else "theory"

        entries.append({
            "subject": subject[:80],
            "subject_code": subject_code,
            "class_type": class_type,
            "batch": batch if is_lab else "ALL",
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
