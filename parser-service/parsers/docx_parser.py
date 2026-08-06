"""
docx_parser.py — Extract timetable entries from .docx files using python-docx.

Replaces the mammoth-based HTML extraction in the JS upload route.
python-docx gives us direct access to the table grid, which is cleaner
than parsing HTML from mammoth.
"""

from docx import Document
from io import BytesIO
from typing import List

from .mapper import (
    DAYS,
    find_period_info,
    parse_slot_content,
    is_lab_content,
    build_entry,
)


def parse_docx(file_bytes: bytes, program: str, semester: int, division: str | None) -> List[dict]:
    """
    Parse a .docx timetable file and return structured entries.
    
    Strategy:
    1. Find the timetable table (the one with day names in the header row).
    2. Map column indices to day names.
    3. For each subsequent row, read the time column and each day column.
    4. Split multi-line cells for batch-level practicals.
    """
    doc = Document(BytesIO(file_bytes))
    entries = []

    for table in doc.tables:
        day_columns = _find_day_columns(table)
        if not day_columns:
            continue

        # Process data rows (skip header row)
        for row_idx in range(1, len(table.rows)):
            row = table.rows[row_idx]
            cells = row.cells

            if len(cells) < 2:
                continue

            # First cell is the time column
            time_text = cells[0].text.strip()
            if "RECESS" in time_text.upper():
                continue

            slot_info = find_period_info(time_text)
            if not slot_info:
                continue

            # Process each day column
            for col_idx, day_name in day_columns.items():
                if col_idx >= len(cells):
                    continue

                cell_text = cells[col_idx].text.strip()
                if not cell_text or len(cell_text) < 2 or "RECESS" in cell_text.upper():
                    continue

                # Split by newlines to handle multi-batch cells
                lines = [ln.strip() for ln in cell_text.split("\n") if ln.strip() and len(ln.strip()) > 1]

                for line_content in lines:
                    is_lab = is_lab_content(line_content)
                    parsed = parse_slot_content(line_content, is_lab)
                    if parsed:
                        entries.append(
                            build_entry(
                                day=day_name,
                                period=slot_info["period"],
                                start_time=slot_info["start"],
                                end_time=slot_info["end"],
                                subject=parsed["subject"],
                                class_type="practical" if is_lab else "theory",
                                batch=parsed["batch"],
                                faculty=parsed["faculty"],
                                room=parsed["room"],
                            )
                        )

    return entries


def _find_day_columns(table) -> dict:
    """
    Scan the first few rows of a table to find which columns
    correspond to which days.
    Returns: {col_index: "Monday", col_index: "Tuesday", ...}
    """
    day_upper = {d.upper(): d for d in DAYS}

    for row_idx in range(min(3, len(table.rows))):
        row = table.rows[row_idx]
        mapping = {}
        for col_idx, cell in enumerate(row.cells):
            text_upper = cell.text.strip().upper()
            for day_key, day_val in day_upper.items():
                if day_key in text_upper:
                    mapping[col_idx] = day_val
                    break
        # Need at least 3 days to be confident this is a timetable header
        if len(mapping) >= 3:
            return mapping

    return {}
