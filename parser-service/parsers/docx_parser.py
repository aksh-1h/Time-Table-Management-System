"""
docx_parser.py — Extract timetable entries from .docx files.
Supports python-docx if installed, or standard library zipfile XML extraction fallback.
"""

from __future__ import annotations

import io
import re
import xml.etree.ElementTree as ET
import zipfile
from typing import List, Optional

from .mapper import (
    DAYS,
    DAY_ALIASES,
    build_entry,
    find_period_info,
    parse_cell_to_entries,
)

# Check if python-docx is available
try:
    from docx import Document
    HAS_DOCX = True
except ImportError:
    HAS_DOCX = False


def parse_docx(file_bytes: bytes, program: str, semester: int, division: Optional[str] = None) -> List[dict]:
    """Parse a .docx timetable file using python-docx or native zipfile XML parser."""
    if HAS_DOCX:
        try:
            return _parse_docx_with_lib(file_bytes)
        except Exception as err:
            print(f"[docx_parser] python-docx failed ({err}), falling back to native XML parser")

    return _parse_docx_native_xml(file_bytes)


def _parse_cell(cell_text: str, day_name: str, slot_info: dict) -> List[dict]:
    """
    Parse a single cell's text into timetable entries using grouped block parsing.
    Returns a list of entry dicts ready for the database.
    """
    parsed_blocks = parse_cell_to_entries(cell_text)
    entries = []
    for parsed in parsed_blocks:
        entries.append(
            build_entry(
                day=day_name,
                period=slot_info["period"],
                start_time=slot_info["start"],
                end_time=slot_info["end"],
                subject=parsed["subject"],
                subject_code=parsed.get("subject_code"),
                class_type=parsed["class_type"],
                batch=parsed["batch"],
                faculty=parsed["faculty"],
                room=parsed["room"],
            )
        )
    return entries


def _find_day_columns_flexible(header_cells: list) -> dict:
    """
    Flexible day column detection.
    Matches full names (Monday) AND abbreviations (Mon, Tue, Wed...).
    Returns {col_idx: day_name} mapping.
    """
    mapping = {}
    for col_idx, cell_text in enumerate(header_cells):
        text_upper = cell_text.strip().upper() if isinstance(cell_text, str) else ""
        if not text_upper:
            continue
        # Check against all aliases (full names + abbreviations)
        for alias, day_name in DAY_ALIASES.items():
            if alias in text_upper:
                # Avoid false matches: "THURSDAY" should not match "TUE"
                # Check that alias is a whole word in the text
                if re.search(r"\b" + re.escape(alias) + r"\b", text_upper):
                    mapping[col_idx] = day_name
                    break
    return mapping


def _parse_docx_with_lib(file_bytes: bytes) -> List[dict]:
    doc = Document(io.BytesIO(file_bytes))
    entries = []
    table_count = len(doc.tables)
    print(f"[docx_parser] Found {table_count} table(s) in .docx file")

    for table_idx, table in enumerate(doc.tables):
        # Try flexible day detection across top 15 rows
        day_columns = {}
        header_row_idx = 0
        for row_idx in range(min(15, len(table.rows))):
            row = table.rows[row_idx]
            cell_texts = [cell.text.strip() for cell in row.cells]
            candidate = _find_day_columns_flexible(cell_texts)
            if len(candidate) >= 2:
                day_columns = candidate
                header_row_idx = row_idx
                break

        if not day_columns:
            print(f"[docx_parser] Table {table_idx}: No day columns detected. Header cells: {[c.text.strip()[:30] for c in table.rows[0].cells] if len(table.rows) > 0 else 'empty'}")
            continue

        print(f"[docx_parser] Table {table_idx}: Detected days: {day_columns} at header row {header_row_idx}")

        for row_idx in range(header_row_idx + 1, len(table.rows)):
            row = table.rows[row_idx]
            cells = row.cells
            if len(cells) < 2:
                continue

            time_text = cells[0].text.strip()
            if "RECESS" in time_text.upper():
                continue

            slot_info = find_period_info(time_text)
            if not slot_info:
                if time_text and len(time_text) > 1 and not any(skip in time_text.upper() for skip in ["RECESS", "BREAK", "LUNCH", "SUBJECT CODE", "CLASSROOM NO:", "LAB/", "SIGN"]):
                    print(f"[docx_parser] Table {table_idx}, Row {row_idx}: Could not match time '{time_text}' to any period")
                continue

            # Track processed cells to avoid duplicates from merged columns
            processed_cell_ids = set()

            for col_idx, day_name in day_columns.items():
                if col_idx >= len(cells):
                    continue

                cell = cells[col_idx]
                cell_id = id(cell)
                if cell_id in processed_cell_ids:
                    continue
                processed_cell_ids.add(cell_id)

                cell_text = cell.text.strip()
                if not cell_text or len(cell_text) < 2 or "RECESS" in cell_text.upper():
                    continue

                cell_entries = _parse_cell(cell_text, day_name, slot_info)
                if not cell_entries:
                    print(f"[docx_parser] Table {table_idx}, {day_name} P{slot_info['period']}: Cell text produced 0 entries: '{cell_text[:50]}'")
                entries.extend(cell_entries)

    print(f"[docx_parser] Total entries parsed: {len(entries)}")
    return entries


def _parse_docx_native_xml(file_bytes: bytes) -> List[dict]:
    """Native Python zipfile fallback for .docx files without python-docx library."""
    entries = []
    try:
        with zipfile.ZipFile(io.BytesIO(file_bytes)) as z:
            if "word/document.xml" not in z.namelist():
                print("[docx_parser] No word/document.xml found in .docx file")
                return []
            xml_content = z.read("word/document.xml").decode("utf-8", errors="ignore")

        # Parse tables from XML
        tables = re.findall(r"<w:tbl[\s\S]*?<\/w:tbl>", xml_content)
        print(f"[docx_parser-xml] Found {len(tables)} table(s) in XML")

        for tbl_idx, tbl in enumerate(tables):
            rows_xml = re.findall(r"<w:tr[\s\S]*?<\/w:tr>", tbl)
            grid = []
            for tr in rows_xml:
                cells_xml = re.findall(r"<w:tc[\s\S]*?<\/w:tc>", tr)
                row_text = []
                for tc in cells_xml:
                    t_matches = re.findall(r"<w:t[^>]*>([\s\S]*?)<\/w:t>", tc)
                    cell_str = " ".join(t_matches).strip()
                    row_text.append(cell_str)
                if row_text:
                    grid.append(row_text)

            if len(grid) < 2:
                continue

            # Flexible day column detection across top 15 rows
            day_columns = {}
            header_row_idx = 0
            for r in range(min(15, len(grid))):
                candidate = _find_day_columns_flexible(grid[r])
                if len(candidate) >= 2:
                    day_columns = candidate
                    header_row_idx = r
                    break

            if not day_columns:
                print(f"[docx_parser-xml] Table {tbl_idx}: No day columns detected. First row: {grid[0][:7] if grid else 'empty'}")
                continue

            print(f"[docx_parser-xml] Table {tbl_idx}: Detected days: {day_columns} at header row {header_row_idx}")

            for r in range(header_row_idx + 1, len(grid)):
                row = grid[r]
                if len(row) < 2:
                    continue

                time_text = row[0]
                if "RECESS" in time_text.upper():
                    continue

                slot_info = find_period_info(time_text)
                if not slot_info:
                    if time_text and len(time_text) > 1 and not any(skip in time_text.upper() for skip in ["RECESS", "BREAK", "LUNCH", "SUBJECT CODE", "CLASSROOM NO:", "LAB/", "SIGN"]):
                        print(f"[docx_parser-xml] Table {tbl_idx}, Row {r}: Could not match time '{time_text}' to any period")
                    continue

                for col_idx, day_name in day_columns.items():
                    if col_idx >= len(row):
                        continue

                    cell_text = row[col_idx]
                    if not cell_text or len(cell_text) < 2 or "RECESS" in cell_text.upper():
                        continue

                    entries.extend(_parse_cell(cell_text, day_name, slot_info))

    except Exception as e:
        print(f"[docx_parser-xml] Native XML parse error: {e}")
        import traceback
        traceback.print_exc()

    print(f"[docx_parser-xml] Total entries parsed: {len(entries)}")
    return entries
