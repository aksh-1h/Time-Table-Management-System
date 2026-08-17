"""
pdf_parser.py — Extract timetable entries from .pdf files.
Supports pdfplumber if installed, or standard library zlib stream text fallback.
"""

from __future__ import annotations

import io
import re
import zlib
from typing import List, Optional

from .mapper import (
    DAYS,
    DAY_ALIASES,
    build_entry,
    find_period_info,
    is_lab_content,
    parse_cell_to_entries,
    parse_slot_content,
)

# Check if pdfplumber is available
try:
    import pdfplumber
    HAS_PDFPLUMBER = True
except ImportError:
    HAS_PDFPLUMBER = False


def parse_pdf(file_bytes: bytes, program: str, semester: int, division: Optional[str] = None) -> List[dict]:
    """Parse a .pdf timetable file using pdfplumber or native zlib stream text parser."""
    if HAS_PDFPLUMBER:
        try:
            entries = _parse_pdf_with_lib(file_bytes)
            if entries:
                return entries
        except Exception as err:
            print(f"[pdf_parser] pdfplumber failed ({err}), falling back to native stream reader")

    return _parse_pdf_native_stream(file_bytes)


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


def _parse_pdf_with_lib(file_bytes: bytes) -> List[dict]:
    entries = []
    with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
        for page in pdf.pages:
            tables = page.extract_tables()
            for table_data in tables:
                if not table_data or len(table_data) < 2:
                    continue

                day_columns = _find_day_columns_in_grid(table_data)
                if not day_columns:
                    continue

                header_row_idx = day_columns.pop("__header_row_idx__", 0)
                for row_idx in range(header_row_idx + 1, len(table_data)):
                    row = table_data[row_idx]
                    if not row or len(row) < 2:
                        continue

                    time_text = (row[0] or "").strip()
                    if "RECESS" in time_text.upper():
                        continue

                    slot_info = find_period_info(time_text)
                    if not slot_info:
                        continue

                    for col_idx, day_name in day_columns.items():
                        if col_idx >= len(row):
                            continue

                        cell_text = (row[col_idx] or "").strip()
                        if not cell_text or len(cell_text) < 2 or "RECESS" in cell_text.upper():
                            continue

                        entries.extend(_parse_cell(cell_text, day_name, slot_info))

    return entries


def _find_day_columns_in_grid(table_data: list) -> dict:
    """Flexible day column detection with abbreviation support."""
    for row_idx in range(min(3, len(table_data))):
        row = table_data[row_idx]
        if not row:
            continue
        mapping = {}
        for col_idx, cell in enumerate(row):
            text_upper = (cell or "").strip().upper()
            if not text_upper:
                continue
            for alias, day_name in DAY_ALIASES.items():
                if re.search(r"\b" + re.escape(alias) + r"\b", text_upper):
                    mapping[col_idx] = day_name
                    break
        if len(mapping) >= 2:  # Relaxed from 3 to 2
            mapping["__header_row_idx__"] = row_idx
            return mapping
    return {}


def _parse_pdf_native_stream(file_bytes: bytes) -> List[dict]:
    """Native Python zlib stream reader for .pdf files without pdfplumber library."""
    extracted_text = ""
    try:
        buffer_str = file_bytes.decode("latin1", errors="ignore")
        streams = re.findall(r"stream\r?\n([\s\S]*?)\r?\nendstream", buffer_str)

        for raw_str in streams:
            raw_data = raw_str.encode("latin1")
            decompressed = None
            try:
                decompressed = zlib.decompress(raw_data)
            except Exception:
                try:
                    decompressed = zlib.decompress(raw_data, -zlib.MAX_WBITS)
                except Exception:
                    decompressed = raw_data

            if decompressed:
                text = decompressed.decode("utf-8", errors="ignore")
                tj_matches = re.findall(r"\((.*?)\)\s*Tj", text)
                if tj_matches:
                    extracted_text += " ".join(tj_matches) + "\n"

                tj_array_matches = re.findall(r"\[(.*?)\]\s*TJ", text)
                for arr_inner in tj_array_matches:
                    sub_matches = re.findall(r"\((.*?)\)", arr_inner)
                    if sub_matches:
                        extracted_text += "".join(sub_matches) + " "

    except Exception as e:
        print(f"[pdf_parser] Native stream parse error: {e}")

    if not extracted_text.strip():
        return []

    # Parse extracted text lines using day and period matching
    # Native PDF stream gives us unstructured text, so we use line-by-line here
    # (this is the only place where line-by-line is appropriate — unstructured text)
    entries = []
    lines = [ln.strip() for ln in extracted_text.split("\n") if ln.strip()]
    current_day = None
    period_counter = 0

    for line in lines:
        found_day = next((d for d in DAYS if d.lower() in line.lower()), None)
        if found_day:
            current_day = found_day
            period_counter = 0
            continue

        if not current_day:
            continue

        time_match = re.search(r"(\d{1,2}:\d{2})", line)
        if time_match or len(line) > 4:
            is_lab = is_lab_content(line)
            slot_info = find_period_info(time_match.group(1)) if time_match else None
            parsed = parse_slot_content(line, is_lab)
            if parsed:
                entries.append(
                    build_entry(
                        day=current_day,
                        period=slot_info["period"] if slot_info else (period_counter % 6),
                        start_time=slot_info["start"] if slot_info else None,
                        end_time=slot_info["end"] if slot_info else None,
                        subject=parsed["subject"][:50],
                        class_type="practical" if is_lab else "theory",
                        batch=parsed["batch"],
                        faculty=parsed["faculty"],
                        room=parsed["room"],
                    )
                )
                period_counter += 1

    return entries
