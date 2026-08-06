"""
TT-FOP Parser Microservice
===========================
FastAPI service that receives uploaded timetable files (PDF or DOCX),
extracts the schedule grid, and returns structured JSON entries.

Endpoints:
  POST /parse-timetable   — Accepts multipart file upload, returns parsed entries
  GET  /health            — Health check for Render / monitoring
"""

# pyrefly: ignore [missing-import]
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
# pyrefly: ignore [missing-import]
from fastapi.middleware.cors import CORSMiddleware
import json

from parsers.docx_parser import parse_docx
from parsers.pdf_parser import parse_pdf

app = FastAPI(
    title="TT-FOP Parser Service",
    description="Timetable file parser for the TT-FOP scheduling system",
    version="1.0.0",
)

# Allow CORS from the Next.js frontend (dev + production)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Tighten in production
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    """Health check endpoint for Render / uptime monitoring."""
    return {"status": "ok", "service": "tt-fop-parser"}


@app.post("/parse-timetable")
async def parse_timetable(
    file: UploadFile = File(...),
    program: str = Form(...),
    semester: int = Form(...),
    division: str = Form(None),
):
    """
    Accept a timetable file (PDF or DOCX) and return parsed slot entries.
    
    The file is NOT stored — it's parsed in memory and the structured
    entries are returned as JSON. The caller (Node.js upload route)
    handles Supabase storage and DB insertion.
    
    Returns:
        {
            "success": true,
            "entries": [ ... ],
            "count": 42,
            "parser": "docx" | "pdf" | "json" | "text"
        }
    """
    file_bytes = await file.read()
    filename = file.filename or ""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    entries = []
    parser_used = "unknown"

    # ── Strategy 1: Try JSON format ──
    try:
        text = file_bytes.decode("utf-8")
        json_content = json.loads(text)
        if isinstance(json_content.get("slots"), list):
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
            ]
            parser_used = "json"
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError):
        pass

    # ── Strategy 2: DOCX table extraction ──
    if not entries and ext == "docx":
        try:
            entries = parse_docx(file_bytes, program, semester, division)
            parser_used = "docx"
        except Exception as e:
            print(f"[parser] DOCX parsing error: {e}")

    # ── Strategy 3: PDF table extraction ──
    if not entries and ext == "pdf":
        try:
            entries = parse_pdf(file_bytes, program, semester, division)
            parser_used = "pdf"
        except Exception as e:
            print(f"[parser] PDF parsing error: {e}")

    # ── Strategy 4: Raw text fallback ──
    if not entries:
        try:
            text = file_bytes.decode("utf-8", errors="ignore")
            entries = _parse_raw_text(text, program, semester, division)
            parser_used = "text"
        except Exception as e:
            print(f"[parser] Text parsing error: {e}")

    if not entries:
        raise HTTPException(
            status_code=400,
            detail="No valid timetable entries could be extracted from the uploaded file.",
        )

    return {
        "success": True,
        "entries": entries,
        "count": len(entries),
        "parser": parser_used,
    }


def _parse_raw_text(text: str, program: str, semester: int, division: str | None) -> list:
    """
    Fallback text parser — replicates parseRawTextToEntries from the JS route.
    Scans for day names and extracts subsequent lines as slots.
    """
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

        import re
        time_match = re.search(r"(\d{1,2}:\d{2})", line)
        if time_match or len(line) > 4:
            is_lab = any(kw in line.lower() for kw in ["lab", "practical"])
            entries.append({
                "day": current_day,
                "period": period_counter % 6,
                "start_time": time_match.group(1) if time_match else None,
                "end_time": None,
                "subject": line[:30],
                "subject_code": None,
                "class_type": "practical" if is_lab else "theory",
                "batch": "ALL",
                "faculty": "Faculty Instructor",
                "room": None,
            })
            period_counter += 1

    return entries
