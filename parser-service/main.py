"""
TT-FOP Parser Microservice
===========================
Dual-mode HTTP service that receives uploaded timetable files (PDF, DOCX, JSON, TXT),
extracts schedule entries, and returns structured JSON entries.

Runs seamlessly via FastAPI + Uvicorn if packages are installed,
or falls back to Python's built-in HTTPServer if third-party packages are missing.

Endpoints:
  POST /parse-timetable   — Accepts multipart file upload, returns parsed entries
  GET  /health            — Health check for Render / local monitoring
"""

import json
import io
import os
import re
import sys
from pathlib import Path
from typing import List, Optional

# Ensure directory containing main.py is in sys.path for module imports
file_dir = Path(__file__).resolve().parent
if str(file_dir) not in sys.path:
    sys.path.insert(0, str(file_dir))

from parsers.docx_parser import parse_docx
from parsers.pdf_parser import parse_pdf
from parsers.mapper import (
    DAYS,
    build_entry,
    find_period_info,
    is_lab_content,
    parse_slot_content,
    parse_cell_to_entries,
)


VALID_DAYS = {"Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"}
VALID_CLASS_TYPES = {"theory", "practical", "self_study"}


def calculate_parsing_score(entry: dict) -> int:
    """
    Calculate a 0–100 parsing confidence score for a single timetable entry.

    Scoring breakdown (optimized for university timetables):
      Subject present (>= 2 chars):  25 pts
      Faculty present:               25 pts
      Day is valid weekday:          10 pts
      Start & end time present:      10 pts
      Room present (optional):       10 pts  (theory entries often have no room)
      Batch specified:                5 pts
      Subject code (optional):        5 pts
      Class type is valid:            5 pts
      Period is valid (0–5):          5 pts
    """
    score = 0

    # Subject: 25 pts (>= 2 chars to accept "GP", "BPP" etc.)
    subject = (entry.get("subject") or "").strip()
    if subject and len(subject) >= 2:
        score += 25

    # Faculty: 25 pts
    faculty = (entry.get("faculty") or "").strip()
    if faculty and len(faculty) >= 2:
        score += 25

    # Day: 10 pts
    day = (entry.get("day") or "").strip()
    if day in VALID_DAYS:
        score += 10

    # Start & end time: 10 pts (5 each)
    start_time = entry.get("start_time")
    end_time = entry.get("end_time")
    if start_time:
        score += 5
    if end_time:
        score += 5

    # Room: 10 pts (optional — theory entries legitimately have no room)
    room = (entry.get("room") or "").strip()
    if room and len(room) >= 1:
        score += 10

    # Batch: 5 pts
    batch = (entry.get("batch") or "").strip()
    if batch and batch != "":
        score += 5

    # Subject code (optional): 5 pts
    subject_code = (entry.get("subject_code") or "").strip()
    if subject_code and re.match(r"^[A-Z]{1,3}\d{3,4}[A-Z]{0,2}$", subject_code):
        score += 5

    # Class type: 5 pts
    class_type = (entry.get("class_type") or "").strip().lower()
    if class_type in VALID_CLASS_TYPES:
        score += 5

    # Period: 5 pts
    period = entry.get("period")
    if isinstance(period, int) and 0 <= period <= 5:
        score += 5

    return min(score, 100)


def calculate_overall_score(entries: list) -> float:
    """Calculate the mean parsing score across all entries (0–100)."""
    if not entries:
        return 0.0
    total = sum(e.get("parsing_score", 0) for e in entries)
    return round(total / len(entries), 1)


def process_timetable_file(
    file_bytes: bytes,
    filename: str,
    program: str,
    semester: int,
    division: Optional[str] = None,
) -> dict:
    """Process timetable file across 4 strategies: JSON, DOCX, PDF, Raw Text."""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    entries = []
    parser_used = "unknown"

    # ── Strategy 1: JSON format ──
    try:
        text = file_bytes.decode("utf-8")
        json_content = json.loads(text)
        if isinstance(json_content, dict) and isinstance(json_content.get("slots"), list):
            entries = [
                {
                    "day": s.get("day"),
                    "period": s.get("period"),
                    "start_time": s.get("start_time"),
                    "end_time": s.get("end_time"),
                    "subject": s.get("subject"),
                    "subject_code": s.get("code") or s.get("subject_code"),
                    "class_type": s.get("type") or s.get("class_type", "theory"),
                    "batch": s.get("batch", "ALL"),
                    "faculty": s.get("faculty"),
                    "room": s.get("room"),
                }
                for s in json_content["slots"]
                if isinstance(s, dict)
            ]
            if entries:
                parser_used = "json"
        elif isinstance(json_content, list):
            entries = [
                {
                    "day": s.get("day", "Monday"),
                    "period": s.get("period", 0),
                    "start_time": s.get("start_time"),
                    "end_time": s.get("end_time"),
                    "subject": s.get("subject", "Untitled"),
                    "subject_code": s.get("subject_code") or s.get("code"),
                    "class_type": s.get("class_type") or s.get("type", "theory"),
                    "batch": s.get("batch", "ALL"),
                    "faculty": s.get("faculty"),
                    "room": s.get("room"),
                }
                for s in json_content
                if isinstance(s, dict)
            ]
            if entries:
                parser_used = "json"
    except Exception:
        pass

    # ── Strategy 2: DOCX table extraction ──
    if not entries and (ext == "docx" or not ext):
        try:
            entries = parse_docx(file_bytes, program, semester, division)
            if entries:
                parser_used = "docx"
        except Exception as e:
            print(f"[parser] DOCX parsing error: {e}")

    # ── Strategy 3: PDF table extraction ──
    if not entries and (ext == "pdf" or not ext):
        try:
            entries = parse_pdf(file_bytes, program, semester, division)
            if entries:
                parser_used = "pdf"
        except Exception as e:
            print(f"[parser] PDF parsing error: {e}")

    # ── Strategy 4: Raw text fallback ──
    if not entries:
        try:
            text = file_bytes.decode("utf-8", errors="ignore")
            entries = _parse_raw_text(text, program, semester, division)
            if entries:
                parser_used = "text"
        except Exception as e:
            print(f"[parser] Text parsing error: {e}")

    # ── Deduplicate entries ──
    # BUG-12 FIX: Include end_time and class_type in the dedup key.
    # Without these, two entries on different periods but with the same
    # subject/batch/faculty would be incorrectly deduped.
    seen = set()
    unique = []
    for e in entries:
        key = (e.get("day"), e.get("period"), e.get("start_time"), e.get("end_time"),
               e.get("subject"), e.get("batch"), e.get("faculty"), e.get("class_type"))
        if key not in seen:
            seen.add(key)
            unique.append(e)
    entries = unique

    # ── Calculate parsing scores ──
    for e in entries:
        e["parsing_score"] = calculate_parsing_score(e)

    overall_score = calculate_overall_score(entries) if entries else 0

    return {
        "success": len(entries) > 0,
        "entries": entries,
        "count": len(entries),
        "parser": parser_used,
        "overall_parsing_score": overall_score,
    }


def _parse_raw_text(text: str, program: str, semester: int, division: Optional[str] = None) -> list:
    entries = []
    lines = [ln.strip() for ln in text.split("\n") if ln.strip()]
    days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

    current_day = None
    period_counter = 0

    for line in lines:
        found_day = next((d for d in days if d.lower() in line.lower()), None)
        if found_day:
            current_day = found_day
            period_counter = 0
            continue

        if not current_day:
            continue

        time_match = re.search(r"(\d{1,2}:\d{2})", line)
        if time_match or len(line) > 4:
            is_lab = is_lab_content(line)
            start_time_val = None
            if time_match:
                parts = time_match.group(1).split(":")
                start_time_val = f"{int(parts[0]):02d}:{parts[1]}:00"

            parsed = parse_slot_content(line, is_lab)
            if parsed:
                entries.append({
                    "day": current_day,
                    "period": period_counter % 6,
                    "start_time": start_time_val,
                    "end_time": None,
                    "subject": parsed["subject"][:50],
                    "subject_code": None,
                    "class_type": "practical" if is_lab else "theory",
                    "batch": parsed["batch"],
                    "faculty": parsed["faculty"] or "Faculty Instructor",
                    "room": parsed["room"],
                })
                period_counter += 1

    return entries


# ── Standard Library Fallback HTTP Server (Always defined) ──
from http.server import HTTPServer, BaseHTTPRequestHandler
from email.parser import BytesParser
from email.policy import default
import traceback


class NativeHTTPRequestHandler(BaseHTTPRequestHandler):
    def _set_headers(self, status=200, content_type="application/json"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def do_OPTIONS(self):
        self._set_headers(200)

    def do_GET(self):
        if self.path.startswith("/health"):
            self._set_headers(200)
            self.wfile.write(json.dumps({"status": "ok", "service": "tt-fop-parser", "mode": "native-std-lib"}).encode())
        else:
            self._set_headers(404)
            self.wfile.write(json.dumps({"error": "Not Found"}).encode())

    def do_POST(self):
        if not self.path.startswith("/parse-timetable"):
            self._set_headers(404)
            self.wfile.write(json.dumps({"error": "Not Found"}).encode())
            return

        try:
            content_type = self.headers.get("Content-Type", "")
            content_length = int(self.headers.get("Content-Length", 0))
            body_bytes = self.rfile.read(content_length)

            msg = BytesParser(policy=default).parsebytes(
                b"Content-Type: " + content_type.encode("utf-8") + b"\r\n\r\n" + body_bytes
            )

            fields = {}
            files = {}
            for part in msg.iter_parts():
                cd = part.get("content-disposition", "")
                name_match = re.search(r'name="([^"]+)"', cd)
                filename_match = re.search(r'filename="([^"]+)"', cd)
                name = name_match.group(1) if name_match else None
                filename = filename_match.group(1) if filename_match else None
                payload = part.get_payload(decode=True)

                if name:
                    if filename is not None:
                        files[name] = {"filename": filename, "data": payload}
                    else:
                        fields[name] = payload.decode("utf-8", errors="ignore") if payload else ""

            file_obj = files.get("file")
            program = fields.get("program", "")
            semester = int(fields.get("semester", 1))
            division = fields.get("division") or None

            if not file_obj or not file_obj["data"]:
                self._set_headers(400)
                self.wfile.write(json.dumps({"error": "Missing file"}).encode())
                return

            res = process_timetable_file(
                file_obj["data"],
                file_obj["filename"],
                program,
                semester,
                division,
            )

            if res["success"]:
                self._set_headers(200)
                self.wfile.write(json.dumps(res).encode())
            else:
                self._set_headers(400)
                self.wfile.write(json.dumps({"error": "No timetable entries found"}).encode())

        except Exception as err:
            self._set_headers(500)
            self.wfile.write(json.dumps({"error": str(err)}).encode())

    def log_message(self, format, *args):
        print(f"[Python-Parser-Native] {format % args}")


def _create_fastapi_app():
    """Try to create the FastAPI app. Returns (app, uvicorn_module) or (None, None)."""
    try:
        from fastapi import FastAPI, File, Form, HTTPException, UploadFile
        from fastapi.middleware.cors import CORSMiddleware
        import uvicorn as _uvicorn
    except ImportError as e:
        print(f"[Python-Parser] FastAPI/Uvicorn not installed: {e}")
        return None, None
    except Exception as e:
        print(f"[Python-Parser] Error importing FastAPI/Uvicorn: {e}")
        traceback.print_exc()
        return None, None

    try:
        _app = FastAPI(
            title="TT-FOP Parser Service",
            description="Timetable file parser for TT-FOP system",
            version="1.0.0",
        )

        _app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_methods=["POST", "GET"],
            allow_headers=["*"],
        )

        @_app.get("/health")
        async def health():
            return {"status": "ok", "service": "tt-fop-parser"}

        @_app.post("/parse-timetable")
        async def parse_timetable(
            file: UploadFile = File(...),
            program: str = Form(...),
            semester: int = Form(...),
            division: Optional[str] = Form(None),
        ):
            file_bytes = await file.read()
            res = process_timetable_file(file_bytes, file.filename or "", program, semester, division)
            if not res["success"]:
                raise HTTPException(
                    status_code=400,
                    detail="No valid timetable entries could be extracted from the uploaded file.",
                )
            return res

        return _app, _uvicorn

    except Exception as e:
        print(f"[Python-Parser] Error creating FastAPI app: {e}")
        traceback.print_exc()
        return None, None


# ── Module-level app export (for `uvicorn main:app` and `gunicorn main:app`) ──
_module_app, _ = _create_fastapi_app()
app = _module_app  # May be None if FastAPI is not installed


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))

    # Try FastAPI first
    fastapi_app, uvicorn_mod = _create_fastapi_app()

    if fastapi_app is not None and uvicorn_mod is not None:
        print(f"[Python-Parser] Starting with FastAPI & Uvicorn on http://127.0.0.1:{port}")
        try:
            uvicorn_mod.run(fastapi_app, host="127.0.0.1", port=port)
        except (Exception, SystemExit) as e:
            print(f"[Python-Parser] Uvicorn startup failed ({e}), falling back to Native HTTP Server...")
            traceback.print_exc()
            fastapi_app = None  # trigger fallback below

    if fastapi_app is None:
        print(f"[Python-Parser] Starting Native Standard Library HTTP Server on http://127.0.0.1:{port}")
        try:
            server = HTTPServer(("127.0.0.1", port), NativeHTTPRequestHandler)
            server.serve_forever()
        except KeyboardInterrupt:
            print("\n[Python-Parser] Server stopped.")
        except (Exception, SystemExit) as e:
            print(f"[Python-Parser] Server error: {e}")
            traceback.print_exc()
