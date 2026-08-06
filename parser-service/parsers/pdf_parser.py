"""
pdf_parser.py — Extract timetable entries from .pdf files using pdfplumber.

pdfplumber detects table grids in PDFs and returns them as lists of lists,
which we then map to days/periods using the same logic as the DOCX parser.
"""

import pdfplumber
from io import BytesIO
from typing import List

from .mapper import (
    DAYS,
    find_period_info,
    parse_slot_content,
    is_lab_content,
    build_entry,
)


def parse_pdf(file_bytes: bytes, program: str, semester: int, division: str | None) -> List[dict]:
    """
    Parse a .pdf timetable file and return structured entries.
    
    Strategy:
    1. Open each page with pdfplumber and extract tables.
    2. For each table, find the header row with day names.
    3. Map columns to days, then process each row.
    """
    entries = []

    with pdfplumber.open(BytesIO(file_bytes)) as pdf:
        for page in pdf.pages:
            tables = page.extract_tables()
            for table_data in tables:
                if not table_data or len(table_data) < 2:
                    continue

                day_columns = _find_day_columns_in_grid(table_data)
                if not day_columns:
                    continue

                # Process data rows (skip header row found)
                header_row_idx = day_columns.pop("__header_row_idx__", 0)
                for row_idx in range(header_row_idx + 1, len(table_data)):
                    row = table_data[row_idx]
                    if not row or len(row) < 2:
                        continue

                    # First cell is the time column
                    time_text = (row[0] or "").strip()
                    if "RECESS" in time_text.upper():
                        continue

                    slot_info = find_period_info(time_text)
                    if not slot_info:
                        continue

                    # Process each day column
                    for col_idx, day_name in day_columns.items():
                        if col_idx >= len(row):
                            continue

                        cell_text = (row[col_idx] or "").strip()
                        if not cell_text or len(cell_text) < 2 or "RECESS" in cell_text.upper():
                            continue

                        # Split by newlines for multi-batch entries
                        lines = [
                            ln.strip()
                            for ln in cell_text.split("\n")
                            if ln.strip() and len(ln.strip()) > 1
                        ]

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


def _find_day_columns_in_grid(table_data: list) -> dict:
    """
    Scan the first few rows of a 2D grid to find day-column mappings.
    Returns: {col_index: "Monday", ..., "__header_row_idx__": int}
    """
    day_upper = {d.upper(): d for d in DAYS}

    for row_idx in range(min(3, len(table_data))):
        row = table_data[row_idx]
        if not row:
            continue
        mapping = {}
        for col_idx, cell in enumerate(row):
            text_upper = (cell or "").strip().upper()
            for day_key, day_val in day_upper.items():
                if day_key in text_upper:
                    mapping[col_idx] = day_val
                    break
        if len(mapping) >= 3:
            mapping["__header_row_idx__"] = row_idx
            return mapping

    return {}
