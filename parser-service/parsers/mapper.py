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
    "faculty": "Ms. Jahnavi Soni",
    "room": null
}
"""

import re
from typing import Optional

# ── Period definitions (matches the existing JS findPeriodInfo) ──
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


def find_period_info(time_text: str) -> Optional[dict]:
    """Match a time-cell string to the corresponding period info."""
    if not time_text:
        return None
    clean = re.sub(r"\s+", "", time_text)
    for p in PERIOD_MAP:
        for marker in p["markers"]:
            if marker in clean:
                return {"period": p["period"], "start": p["start"], "end": p["end"]}
    return None


def parse_slot_content(content: str, is_lab: bool = False) -> Optional[dict]:
    """
    Parse a single cell's text content into structured slot fields.
    Returns None if the cell is empty or a recess marker.
    """
    clean = re.sub(r"\s+", " ", content).strip()
    if not clean or len(clean) < 2 or "RECESS" in clean.upper():
        return None

    batch = "ALL"
    room = None
    faculty = None

    # Detect batch letter
    batch_match = re.search(r"(?:BATCH|BATCH\s*:?)\s*([A-D])", clean, re.IGNORECASE)
    if batch_match:
        batch = batch_match.group(1).upper()

    # Detect room number (3-digit, optionally followed by a letter, or "PSH")
    room_match = re.search(r"(?:ROOM|LAB|HALL)?\s*([0-9]{3}\s*[A-Z]?|PSH)\b", clean, re.IGNORECASE)
    if room_match:
        room = room_match.group(1).strip()

    # Detect faculty name (Dr./Prof./Mr./Ms./Mrs./Faculty prefix)
    faculty_match = re.search(
        r"(?:Dr\.|Prof\.|Mr\.|Ms\.|Mrs\.|Faculty)\s+([A-Za-z\s.]+)", clean, re.IGNORECASE
    )
    if faculty_match:
        faculty = faculty_match.group(0).strip()

    return {
        "subject": clean,
        "batch": batch if is_lab else "ALL",
        "room": room,
        "faculty": faculty,
    }


def is_lab_content(text: str) -> bool:
    """Check if cell content indicates a practical/lab session."""
    upper = text.upper()
    return any(kw in upper for kw in ["BATCH", "LAB", "PRACTICAL"])


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
