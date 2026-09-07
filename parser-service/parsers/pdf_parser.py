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
    """Parse a .pdf timetable file using pdfplumber, native Windows OCR, or native zlib stream."""
    if HAS_PDFPLUMBER:
        try:
            entries = _parse_pdf_with_lib(file_bytes)
            if entries:
                return entries
        except Exception as err:
            print(f"[pdf_parser] pdfplumber failed ({err})")

    # ── Strategy 4: Native Windows OCR fallback (for scanned image PDFs) ──
    try:
        ocr_entries = _parse_pdf_with_ocr(file_bytes)
        if ocr_entries:
            print(f"[pdf_parser] OCR successfully extracted {len(ocr_entries)} entries")
            return ocr_entries
    except Exception as err:
        print(f"[pdf_parser] OCR fallback error: {err}")

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
            # ── Strategy 1: Explicit line-based tables ──
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

            if entries:
                return entries

            # ── Strategy 2: Text-strategy tables ──
            try:
                tables_text = page.extract_tables(table_settings={"vertical_strategy": "text", "horizontal_strategy": "text"})
                for table_data in tables_text:
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
            except Exception as e:
                print(f"[pdf_parser] Text strategy table extraction error: {e}")

            if entries:
                return entries

            # ── Strategy 3: Spatial word-grid extraction ──
            try:
                spatial_entries = _extract_spatial_timetable_from_pdf(page)
                if spatial_entries:
                    entries.extend(spatial_entries)
            except Exception as e:
                print(f"[pdf_parser] Spatial word extraction error: {e}")

    return entries


def _words_to_cell_text(cell_words: list, y_key: str = "top", y_threshold: float = 10.0) -> str:
    """Group cell words into logical lines by y-coordinate proximity.
    
    Instead of joining all words with spaces (which loses line structure),
    this groups words that are at similar y positions into lines and joins
    lines with newlines. This is critical for parse_cell_to_entries to
    properly distinguish subject/faculty/room lines in scanned PDFs.
    """
    if not cell_words:
        return ""
    
    # Sort by y then x
    sorted_words = sorted(cell_words, key=lambda w: (w[y_key], w["x0"]))
    
    lines = []
    current_line_words = [sorted_words[0]]
    current_y = sorted_words[0][y_key]
    
    for w in sorted_words[1:]:
        if abs(w[y_key] - current_y) <= y_threshold:
            # Same line
            current_line_words.append(w)
        else:
            # New line
            lines.append(" ".join(cw["text"] for cw in current_line_words))
            current_line_words = [w]
            current_y = w[y_key]
    
    if current_line_words:
        lines.append(" ".join(cw["text"] for cw in current_line_words))
    
    return "\n".join(lines)


def _extract_spatial_timetable_from_pdf(page) -> List[dict]:
    """Extract timetable cells using word bounding boxes when tables have no visible border lines."""
    words = page.extract_words()
    if not words:
        return []

    day_map = {
        "MON": "Monday", "MONDAY": "Monday",
        "TUE": "Tuesday", "TUESDAY": "Tuesday",
        "WED": "Wednesday", "WEDNESDAY": "Wednesday",
        "THU": "Thursday", "THURSDAY": "Thursday",
        "FRI": "Friday", "FRIDAY": "Friday",
        "SAT": "Saturday", "SATURDAY": "Saturday",
    }

    day_headers = []
    for w in words:
        txt = re.sub(r"[^A-Z]", "", w["text"].upper())
        if txt in day_map:
            day_headers.append({
                "day": day_map[txt],
                "x0": w["x0"],
                "x1": w["x1"],
                "xc": (w["x0"] + w["x1"]) / 2,
                "top": w["top"],
                "bottom": w["bottom"],
            })

    unique_days = {}
    for dh in day_headers:
        if dh["day"] not in unique_days or dh["top"] < unique_days[dh["day"]]["top"]:
            unique_days[dh["day"]] = dh

    sorted_days = sorted(unique_days.values(), key=lambda d: d["xc"])
    if len(sorted_days) < 3:
        return []

    col_bounds = []
    for i in range(len(sorted_days)):
        left = (sorted_days[i-1]["xc"] + (sorted_days[i]["xc"] - sorted_days[i-1]["xc"])/2) if i > 0 else (sorted_days[i]["x0"] - 30)
        right = (sorted_days[i]["xc"] + (sorted_days[i+1]["xc"] - sorted_days[i]["xc"])/2) if i < len(sorted_days)-1 else (sorted_days[i]["x1"] + 80)
        col_bounds.append({
            "day": sorted_days[i]["day"],
            "x_min": left,
            "x_max": right,
        })

    header_top = min(d["top"] for d in sorted_days)
    body_words = [w for w in words if w["top"] > header_top + 10]

    # Detect Time Rows by grouping time column words into lines
    time_words = [w for w in body_words if w["x0"] < sorted_days[0]["x0"]]
    time_words.sort(key=lambda w: (w["top"], w["x0"]))
    time_lines = []
    if time_words:
        cur_line = [time_words[0]]
        cur_top = time_words[0]["top"]
        for w in time_words[1:]:
            if abs(w["top"] - cur_top) <= 12:
                cur_line.append(w)
            else:
                time_lines.append(cur_line)
                cur_line = [w]
                cur_top = w["top"]
        if cur_line:
            time_lines.append(cur_line)

    time_rows = []
    for line_words in time_lines:
        line_str = " ".join(cw["text"] for cw in line_words).strip()
        avg_top = sum(cw["top"] for cw in line_words) / len(line_words)
        slot_info = find_period_info(line_str)
        if slot_info:
            time_rows.append({
                "time_str": line_str,
                "top": avg_top,
                "slot_info": slot_info,
            })

    entries = []
    for r_idx, tr in enumerate(time_rows):
        slot_info = tr["slot_info"]

        y_min = tr["top"] - 10
        y_max = time_rows[r_idx+1]["top"] - 5 if r_idx < len(time_rows)-1 else tr["top"] + 60

        for col in col_bounds:
            cell_words = [
                w for w in body_words
                if y_min <= w["top"] <= y_max and col["x_min"] <= (w["x0"] + w["x1"])/2 <= col["x_max"]
            ]
            cell_words.sort(key=lambda w: (w["top"], w["x0"]))
            cell_text = _words_to_cell_text(cell_words, y_key="top", y_threshold=8.0)

            if not cell_text or "RECESS" in cell_text.upper():
                continue

            parsed = parse_cell_to_entries(cell_text)
            for p in parsed:
                entries.append(build_entry(
                    day=col["day"],
                    period=slot_info["period"],
                    start_time=slot_info["start"],
                    end_time=slot_info["end"],
                    subject=p["subject"],
                    subject_code=p.get("subject_code"),
                    class_type=p["class_type"],
                    batch=p["batch"],
                    faculty=p["faculty"],
                    room=p["room"],
                ))

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


def _preprocess_for_ocr(pil_img):
    """Preprocess a PIL image for better OCR accuracy on scanned timetables.

    Only improves the image quality fed to the OCR engine.
    Does NOT change any coordinates, thresholds, or parsing logic.
    """
    try:
        from PIL import ImageEnhance, ImageOps

        # Convert to grayscale — removes color noise
        gray = pil_img.convert("L")

        # Auto-contrast — normalizes brightness/darkness across the page
        gray = ImageOps.autocontrast(gray, cutoff=1)

        # Boost contrast so text stands out from background
        gray = ImageEnhance.Contrast(gray).enhance(1.8)

        # Sharpen to make character edges crisper
        gray = ImageEnhance.Sharpness(gray).enhance(2.0)

        # Convert back to RGB (WinRT OCR expects color input)
        return gray.convert("RGB")
    except ImportError:
        return pil_img


def _clean_ocr_word(text: str) -> str:
    """Fix common OCR character misreadings in a single word.

    Only fixes character-level errors. Does NOT change word boundaries,
    coordinates, or any parsing logic.
    """
    if not text:
        return text
    t = text
    # Semicolons misread instead of colons in time values
    t = t.replace(";", ":")
    # Pipes/bars misread as I or l
    t = t.replace("|", "I")
    # Stray backticks/tildes from image noise
    t = t.replace("`", "").replace("~", "")
    # Zero-width unicode artifacts
    t = t.replace("\u200b", "").replace("\u00ad", "").replace("\ufeff", "")
    return t.strip()


def _parse_pdf_with_ocr(file_bytes: bytes) -> List[dict]:
    """Extract timetable cells from image-based scanned PDFs using native Windows WinRT OCR."""
    try:
        import asyncio
        import pypdfium2 as pdfium
        import winocr
    except ImportError as e:
        print(f"[pdf_parser] OCR dependencies not available: {e}")
        return []

    async def _run():
        pdf = pdfium.PdfDocument(io.BytesIO(file_bytes))
        entries = []

        day_map = {
            "MON": "Monday", "MONDAY": "Monday",
            "TUE": "Tuesday", "TUESDAY": "Tuesday",
            "WED": "Wednesday", "WEDNESDAY": "Wednesday",
            "THU": "Thursday", "THURSDAY": "Thursday",
            "FRI": "Friday", "FRIDAY": "Friday",
            "SAT": "Saturday", "SATURDAY": "Saturday",
        }

        for page_idx in range(len(pdf)):
            page = pdf[page_idx]
            bitmap = page.render(scale=200 / 72)
            pil_img = bitmap.to_pil()
            if max(pil_img.width, pil_img.height) > 3000:
                scale_factor = 3000 / max(pil_img.width, pil_img.height)
                new_size = (int(pil_img.width * scale_factor), int(pil_img.height * scale_factor))
                pil_img = pil_img.resize(new_size)

            # Preprocess image for better OCR character recognition
            pil_img = _preprocess_for_ocr(pil_img)

            ocr_res = await winocr.recognize_pil(pil_img, lang="en")
            if not ocr_res or not hasattr(ocr_res, "lines"):
                continue

            all_words = []
            for line in ocr_res.lines:
                for w in line.words:
                    # Clean common OCR misreadings (;→: |→I etc.)
                    cleaned_text = _clean_ocr_word(w.text)
                    if not cleaned_text:
                        continue
                    all_words.append({
                        "text": cleaned_text,
                        "x0": w.bounding_rect.x,
                        "y0": w.bounding_rect.y,
                        "x1": w.bounding_rect.x + w.bounding_rect.width,
                        "y1": w.bounding_rect.y + w.bounding_rect.height,
                        "xc": w.bounding_rect.x + w.bounding_rect.width / 2,
                        "yc": w.bounding_rect.y + w.bounding_rect.height / 2,
                    })

            # Detect Day Columns
            day_headers = []
            for w in all_words:
                clean = re.sub(r"[^A-Z]", "", w["text"].upper())
                if clean in day_map:
                    day_headers.append({
                        "day": day_map[clean],
                        "x0": w["x0"],
                        "x1": w["x1"],
                        "xc": w["xc"],
                        "y0": w["y0"],
                        "y1": w["y1"],
                    })

            unique_days = {}
            for dh in day_headers:
                if dh["day"] not in unique_days or dh["y0"] < unique_days[dh["day"]]["y0"]:
                    unique_days[dh["day"]] = dh

            sorted_days = sorted(unique_days.values(), key=lambda d: d["xc"])
            if len(sorted_days) < 3:
                continue

            col_bounds = []
            for i in range(len(sorted_days)):
                left = (sorted_days[i-1]["xc"] + (sorted_days[i]["xc"] - sorted_days[i-1]["xc"])/2) if i > 0 else (sorted_days[i]["x0"] - 60)
                right = (sorted_days[i]["xc"] + (sorted_days[i+1]["xc"] - sorted_days[i]["xc"])/2) if i < len(sorted_days)-1 else (sorted_days[i]["x1"] + 150)
                col_bounds.append({
                    "day": sorted_days[i]["day"],
                    "x_min": left,
                    "x_max": right,
                })

            header_y = min(d["y0"] for d in sorted_days)
            body_words = [w for w in all_words if w["y0"] > header_y + 20]

            # Detect Time Rows by grouping time column words into lines
            time_words = [w for w in body_words if w["x0"] < sorted_days[0]["x0"] + 30]
            time_words.sort(key=lambda w: (w["y0"], w["x0"]))
            time_lines = []
            if time_words:
                cur_line = [time_words[0]]
                cur_y = time_words[0]["y0"]
                for w in time_words[1:]:
                    if abs(w["y0"] - cur_y) <= 25:
                        cur_line.append(w)
                    else:
                        time_lines.append(cur_line)
                        cur_line = [w]
                        cur_y = w["y0"]
                if cur_line:
                    time_lines.append(cur_line)

            time_rows = []
            for line_words in time_lines:
                line_str = " ".join(cw["text"] for cw in line_words).strip()
                avg_y = sum(cw["y0"] for cw in line_words) / len(line_words)
                slot_info = find_period_info(line_str)
                if slot_info:
                    time_rows.append({
                        "time_str": line_str,
                        "y0": avg_y,
                        "slot_info": slot_info,
                    })

            for r_idx, tr in enumerate(time_rows):
                slot_info = tr["slot_info"]

                y_min = tr["y0"] - 20
                y_max = time_rows[r_idx+1]["y0"] - 10 if r_idx < len(time_rows)-1 else tr["y0"] + 150

                for col in col_bounds:
                    cell_words = [
                        w for w in body_words
                        if y_min <= w["yc"] <= y_max and col["x_min"] <= w["xc"] <= col["x_max"]
                    ]
                    cell_words.sort(key=lambda w: (w["y0"], w["x0"]))
                    cell_text = _words_to_cell_text(cell_words, y_key="y0", y_threshold=15.0)

                    if not cell_text or "RECESS" in cell_text.upper():
                        continue

                    parsed = parse_cell_to_entries(cell_text)
                    for p in parsed:
                        entries.append(build_entry(
                            day=col["day"],
                            period=slot_info["period"],
                            start_time=slot_info["start"],
                            end_time=slot_info["end"],
                            subject=p["subject"],
                            subject_code=p.get("subject_code"),
                            class_type=p["class_type"],
                            batch=p["batch"],
                            faculty=p["faculty"],
                            room=p["room"],
                        ))

        return entries

    try:
        import asyncio
        # Handle cases where an event loop is already running (e.g. within FastAPI/Uvicorn)
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        if loop and loop.is_running():
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as pool:
                return pool.submit(lambda: asyncio.run(_run())).result()
        else:
            return asyncio.run(_run())
    except Exception as err:
        print(f"[pdf_parser] OCR execution error: {err}")
        return []
