# TT-FOP Parser Microservice

FastAPI-based timetable file parser for the TT-FOP scheduling system.

## What it does

Accepts uploaded timetable files (PDF, DOCX, JSON, or plain text) and extracts structured schedule entries. Returns JSON that the Next.js upload route inserts directly into the Supabase `timetable_entries` table.

## Local Development

```bash
cd parser-service

# Create virtual environment
python -m venv venv

# Activate (Windows)
venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run dev server
uvicorn main:app --reload --port 8000
```

The service will be available at `http://localhost:8000`.

- **POST** `/parse-timetable` — Upload a file and get parsed entries
- **GET** `/health` — Health check

## Testing

```bash
# Health check
curl http://localhost:8000/health

# Parse a DOCX file
curl -X POST http://localhost:8000/parse-timetable \
  -F "file=@timetable.docx" \
  -F "program=B.Pharm" \
  -F "semester=1" \
  -F "division=A"
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
