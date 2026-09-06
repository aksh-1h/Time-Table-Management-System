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
    PERIOD_MAP,
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


def _resolve_faculty_from_metadata(faculty_str: Optional[str], faculty_map: dict) -> Optional[str]:
    """Resolve faculty code or initials against document metadata map."""
    if not faculty_str:
        return faculty_str

    fc_code = faculty_str[3:] if faculty_str.startswith("FC:") else faculty_str
    fc_code = fc_code.strip()

    # Exact match in metadata map
    if fc_code in faculty_map:
        return faculty_map[fc_code]

    # Handle slashes: "APP/RKS" -> resolve each part
    if "/" in fc_code:
        parts = [p.strip() for p in fc_code.split("/")]
        resolved_parts = [faculty_map.get(p, p) for p in parts]
        return " / ".join(resolved_parts)

    return faculty_map.get(fc_code, faculty_str)


def _parse_cell(cell_text: str, day_name: str, slot_info: dict, doc_metadata: Optional[dict] = None) -> List[dict]:
    """
    Parse a single cell's text into timetable entries using grouped block parsing.
    Returns a list of entry dicts ready for the database.
    """
    parsed_blocks = parse_cell_to_entries(cell_text, doc_metadata=doc_metadata)
    entries = []
    for parsed in parsed_blocks:
        # If doc_metadata has subject_map, try to resolve subject_code
        subject_code = parsed.get("subject_code")
        if not subject_code and doc_metadata and "subject_map" in doc_metadata:
            subject_code = doc_metadata["subject_map"].get(parsed["subject"])

        # If doc_metadata has faculty_map, try to resolve faculty full name
        faculty = parsed.get("faculty")
        if faculty and doc_metadata and "faculty_map" in doc_metadata:
            faculty = _resolve_faculty_from_metadata(faculty, doc_metadata["faculty_map"])

        entries.append(
            build_entry(
                day=day_name,
                period=slot_info["period"],
                start_time=slot_info["start"],
                end_time=slot_info["end"],
                subject=parsed["subject"],
                subject_code=subject_code,
                class_type=parsed["class_type"],
                batch=parsed["batch"],
                faculty=faculty,
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


def _extract_document_metadata(table) -> dict:
    """
    Extract metadata from the legend/footer section of a Parul University timetable table.
    
    Scans rows 14+ for:
    - Subject code → subject initials mapping
    - Faculty initials → full name mapping (supporting combined slashes like APP/RKS)
    - CLASSROOM NO → default theory room
    - LAB/ TUTORIAL LOCATION → lab room list
    
    Returns dict with keys: 'faculty_map', 'subject_map', 'classroom', 'lab_rooms'
    """
    metadata = {
        "faculty_map": {},      # e.g. {"NSP": "Mrs. Nirali Patel", "APP/RKS": "Dr. Akanksha Patel / Dr. Rajesh K S"}
        "subject_map": {},      # e.g. {"POC II": "BP301T", "PP I": "BP302T"}
        "classroom": None,      # e.g. "407"
        "lab_rooms": [],        # e.g. ["201 A", "103", "309", "311"]
    }
    
    try:
        num_rows = len(table.rows)
        if num_rows < 15:
            return metadata
        
        for row_idx in range(14, min(num_rows, 30)):
            row = table.rows[row_idx]
            cells = [cell.text.strip() for cell in row.cells]
            if not cells:
                continue
            
            first_cell = cells[0].upper().strip()
            
            # Detect CLASSROOM NO row: "CLASSROOM NO:" followed by room number
            if "CLASSROOM NO" in first_cell or "CLASSROOM NO:" in first_cell:
                for c in cells:
                    room_match = re.search(r"\b(\d{3}\s*[A-Z]?)\b", c.strip())
                    if room_match:
                        metadata["classroom"] = room_match.group(1).strip()
                        break
                continue
            
            # Detect LAB/ TUTORIAL LOCATION row
            if "LAB" in first_cell and ("TUTORIAL" in first_cell or "LOCATION" in first_cell):
                for c in cells:
                    # Parse comma-separated room numbers: "201 A, 103, 309, 311"
                    rooms = re.findall(r"\b(\d{3}\s*[A-Z]?)\b", c)
                    if rooms and len(rooms) >= 2:
                        metadata["lab_rooms"] = [r.strip() for r in rooms]
                        break
                continue
            
            # Detect subject code rows: "BP301T" in first cell
            code_match = re.match(r"^([A-Z]{1,3}\d{3,4}[A-Z]{0,2})\s*$", first_cell)
            if code_match:
                subject_code = code_match.group(1)
                # Column layout: CODE | INITIALS | INITIALS | FULL_NAME ... | STAFF_INITIALS ... | STAFF_NAME ...
                subject_initials = None
                for ci in range(1, min(4, len(cells))):
                    candidate = cells[ci].strip()
                    if candidate and len(candidate) >= 2 and len(candidate) <= 20 and not re.match(r"^[A-Z]{1,3}\d{3}", candidate):
                        subject_initials = candidate.strip()
                        break
                
                if subject_initials:
                    metadata["subject_map"][subject_initials] = subject_code
                
                # Find faculty initials and full name
                staff_initials = None
                staff_name = None
                for ci in range(7, min(11, len(cells))):
                    candidate = cells[ci].strip()
                    if candidate and len(candidate) >= 2 and len(candidate) <= 15:
                        candidate = candidate.replace("\n", "/").strip()
                        candidate = re.sub(r"\s*/\s*", "/", candidate)
                        if re.match(r"^[A-Z]{2,5}(?:/[A-Z]{2,5})*$", candidate):
                            staff_initials = candidate
                            break
                
                for ci in range(11, min(15, len(cells))):
                    candidate = cells[ci].strip()
                    if candidate and len(candidate) >= 5:
                        candidate = candidate.replace("\n", " / ").strip()
                        candidate = re.sub(r"\s+", " ", candidate)
                        if re.match(r"^(?:Dr\.|Prof\.|Mr\.|Ms\.|Mrs\.)", candidate, re.IGNORECASE):
                            staff_name = candidate
                            break
                
                if staff_initials:
                    if staff_name:
                        metadata["faculty_map"][staff_initials] = staff_name
                        # If compound like "APP/RKS" and "Dr. Akanksha Patel / Dr. Rajesh K S", map individuals too
                        if "/" in staff_initials and "/" in staff_name:
                            inits = [x.strip() for x in staff_initials.split("/") if x.strip()]
                            names = [x.strip() for x in staff_name.split("/") if x.strip()]
                            if len(inits) == len(names):
                                for init, name in zip(inits, names):
                                    metadata["faculty_map"][init] = name
                    else:
                        metadata["faculty_map"][staff_initials] = staff_initials
                
                continue
        
        if metadata["faculty_map"]:
            print(f"[docx_parser] Extracted faculty map: {metadata['faculty_map']}")
        if metadata["subject_map"]:
            print(f"[docx_parser] Extracted subject map: {metadata['subject_map']}")
        if metadata["classroom"]:
            print(f"[docx_parser] Extracted classroom: {metadata['classroom']}")
        if metadata["lab_rooms"]:
            print(f"[docx_parser] Extracted lab rooms: {metadata['lab_rooms']}")
    
    except Exception as e:
        print(f"[docx_parser] Metadata extraction error (non-fatal): {e}")
    
    return metadata


def _parse_docx_with_lib(file_bytes: bytes) -> List[dict]:
    doc = Document(io.BytesIO(file_bytes))
    entries = []
    table_count = len(doc.tables)
    print(f"[docx_parser] Found {table_count} table(s) in .docx file")

    for table_idx, table in enumerate(doc.tables):
        # Extract document metadata from the legend/footer section
        doc_metadata = _extract_document_metadata(table)
        
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
            print(f"[docx_parser] Table {table_idx}: No day columns detected.")
            continue

        print(f"[docx_parser] Table {table_idx}: Detected days: {day_columns} at header row {header_row_idx}")

        # ── MERGED ROW TRACKING ──
        # Track consecutive rows with identical time text (e.g. 3 rows for "09:30 to 12:30").
        # In Parul University timetables:
        # - Row 1 of morning block: Batch C practicals (Period 0) and Saturday Period 0 class
        # - Row 2 of morning block: Batch D practicals (Period 0) and Saturday Period 1 class
        # - Row 3 of morning block: Duplicate of Batch D (ignore) and Saturday Period 2 class
        prev_time_clean = None
        merged_row_idx = 0

        for row_idx in range(header_row_idx + 1, len(table.rows)):
            row = table.rows[row_idx]
            cells = row.cells
            if len(cells) < 2:
                continue

            time_text = cells[0].text.strip()

            if "RECESS" in time_text.upper():
                prev_time_clean = None
                merged_row_idx = 0
                continue

            # Skip metadata rows at the bottom of the table
            upper_time = time_text.upper()
            if any(skip in upper_time for skip in ["SUBJECT CODE", "CLASSROOM NO:", "LAB/", "SIGN", "STAFF", "MFT", "FACULTY NAME", "INSTITUTE", "PROGRAM", "SEMESTER", "PARUL UNIVERSITY"]):
                continue

            # Compare normalized time string across consecutive rows
            clean_time = re.sub(r"\s+", "", time_text).lower()
            if clean_time == prev_time_clean:
                merged_row_idx += 1
            else:
                prev_time_clean = clean_time
                merged_row_idx = 0

            base_slot_info = find_period_info(time_text)
            if not base_slot_info:
                if time_text and len(time_text) > 1 and not any(skip in time_text.upper() for skip in ["RECESS", "BREAK", "LUNCH", "SUBJECT CODE", "CLASSROOM NO:", "LAB/", "SIGN"]):
                    print(f"[docx_parser] Table {table_idx}, Row {row_idx}: Could not match time '{time_text}' to any period")
                prev_time_clean = None
                merged_row_idx = 0
                continue

            # Track processed cells to avoid duplicate column readings within the same row
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

                # Determine correct period for this cell:
                # If Saturday and merged_row_idx > 0, assign incrementing periods:
                # idx 0 -> Period 0, idx 1 -> Period 1, idx 2 -> Period 2
                if day_name == "Saturday" and merged_row_idx > 0:
                    target_period = base_slot_info["period"] + merged_row_idx
                    if target_period <= 5:
                        p_entry = PERIOD_MAP[target_period]
                        slot_info = {
                            "period": target_period,
                            "start": p_entry["start"],
                            "end": p_entry["end"],
                        }
                    else:
                        continue
                else:
                    slot_info = base_slot_info

                cell_entries = _parse_cell(cell_text, day_name, slot_info, doc_metadata=doc_metadata)
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
                print(f"[docx_parser-xml] Table {tbl_idx}: No day columns detected.")
                continue

            print(f"[docx_parser-xml] Table {tbl_idx}: Detected days: {day_columns} at header row {header_row_idx}")

            prev_time_clean = None
            merged_row_idx = 0

            for r in range(header_row_idx + 1, len(grid)):
                row = grid[r]
                if len(row) < 2:
                    continue

                time_text = row[0]
                if "RECESS" in time_text.upper():
                    prev_time_clean = None
                    merged_row_idx = 0
                    continue

                if any(skip in time_text.upper() for skip in ["SUBJECT CODE", "CLASSROOM NO:", "LAB/", "SIGN", "STAFF"]):
                    continue

                clean_time = re.sub(r"\s+", "", time_text).lower()
                if clean_time == prev_time_clean:
                    merged_row_idx += 1
                else:
                    prev_time_clean = clean_time
                    merged_row_idx = 0

                base_slot_info = find_period_info(time_text)
                if not base_slot_info:
                    prev_time_clean = None
                    merged_row_idx = 0
                    continue

                for col_idx, day_name in day_columns.items():
                    if col_idx >= len(row):
                        continue

                    cell_text = row[col_idx]
                    if not cell_text or len(cell_text) < 2 or "RECESS" in cell_text.upper():
                        continue

                    if day_name == "Saturday" and merged_row_idx > 0:
                        target_period = base_slot_info["period"] + merged_row_idx
                        if target_period <= 5:
                            p_entry = PERIOD_MAP[target_period]
                            slot_info = {"period": target_period, "start": p_entry["start"], "end": p_entry["end"]}
                        else:
                            continue
                    else:
                        slot_info = base_slot_info

                    entries.extend(_parse_cell(cell_text, day_name, slot_info))

    except Exception as e:
        print(f"[docx_parser-xml] Native XML parse error: {e}")
        import traceback
        traceback.print_exc()

    print(f"[docx_parser-xml] Total entries parsed: {len(entries)}")
    return entries
