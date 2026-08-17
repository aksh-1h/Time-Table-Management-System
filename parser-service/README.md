# TT-FOP Parser Microservice

FastAPI-based timetable file parser for the TT-FOP scheduling system.

## What it does

Accepts uploaded timetable files (PDF, DOCX, JSON, or plain text) and extracts structured schedule entries with **parsing quality scores**. Returns JSON that the Next.js upload route inserts directly into the Supabase `timetable_entries` table.

## Quick Start (Recommended)

### Option 1: Docker Compose (Both Services)

```bash
cd TT_FOP
docker compose up --build
```

This starts both the parser (port 8000) and the Next.js app (port 3000).

### Option 2: PowerShell Dev Script

```powershell
cd TT_FOP
.\start-dev.ps1
```

Automatically creates the Python venv, installs dependencies, and launches both services.

### Option 3: Manual

```bash
cd parser-service

# Create virtual environment
python -m venv venv

# Activate (Windows)
venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run dev server
python main.py
```

The service will be available at `http://localhost:8000`.

## Endpoints

- **POST** `/parse-timetable` — Upload a file and get parsed entries with quality scores
- **GET** `/health` — Health check

## Parsing Score

Each parsed entry receives a confidence score (0–100) based on completeness:

| Field | Points |
|-------|--------|
| Subject present (> 2 chars) | 20 |
| Subject code (e.g. BP101T) | 15 |
| Faculty present | 15 |
| Room present | 15 |
| Day is valid weekday | 10 |
| Start + end time present | 10 |
| Batch specified | 5 |
| Valid class type | 5 |
| Valid period (0–5) | 5 |

The response includes:
- `parsing_score` per entry
- `overall_parsing_score` (mean of all entries)

## Testing

```bash
cd parser-service
python test_parser.py
```

## Render Deployment (Free Tier)

1. Push `parser-service/` to a GitHub repo (or include it in the existing TT_FOP repo).
2. On [Render Dashboard](https://dashboard.render.com/):
   - Create a **New Web Service**
   - Connect the repo, set **Root Directory** to `parser-service`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `gunicorn main:app -w 2 -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:$PORT`
   - **Instance Type**: Free
3. Once deployed, set `PARSER_SERVICE_URL` in your Next.js `.env.local` to the Render URL (e.g., `https://tt-fop-parser.onrender.com`).

> **Note**: Render free tier spins down after 15 minutes of inactivity. First request after idle may take ~30 seconds to cold start.
