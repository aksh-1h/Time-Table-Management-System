-- ============================================================
-- TT-FOP Migration 002: Timetable Uploads & Entries
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- ============================================================

-- ─── TIMETABLE UPLOADS ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS timetable_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_path TEXT NOT NULL,         -- Path in Supabase Storage bucket 'timetables'
  original_filename TEXT NOT NULL,
  program TEXT NOT NULL,
  semester INT NOT NULL,
  division TEXT,
  status TEXT DEFAULT 'parsed',    -- 'pending', 'parsed', 'failed'
  uploaded_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(program, semester, division) -- Only one active upload per batch for now
);

-- ─── TIMETABLE ENTRIES (RAW PARSED DATA) ────────────────────
CREATE TABLE IF NOT EXISTS timetable_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id UUID REFERENCES timetable_uploads(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  period INT NOT NULL,
  start_time TIME,
  end_time TIME,
  subject TEXT NOT NULL,
  subject_code TEXT,
  class_type TEXT NOT NULL DEFAULT 'theory', -- 'theory', 'practical', 'self_study'
  batch TEXT NOT NULL DEFAULT 'ALL',
  faculty TEXT,
  room TEXT
);

-- ─── RLS POLICIES ───────────────────────────────────────────
ALTER TABLE timetable_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE timetable_entries ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'timetable_uploads'
      AND policyname = 'Authenticated users can read uploads'
  ) THEN
    CREATE POLICY "Authenticated users can read uploads"
    ON timetable_uploads
    FOR SELECT
    TO authenticated
    USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'timetable_uploads'
      AND policyname = 'Authenticated users can modify uploads'
  ) THEN
    CREATE POLICY "Authenticated users can modify uploads"
    ON timetable_uploads
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'timetable_entries'
      AND policyname = 'Authenticated users can read entries'
  ) THEN
    CREATE POLICY "Authenticated users can read entries"
    ON timetable_entries
    FOR SELECT
    TO authenticated
    USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'timetable_entries'
      AND policyname = 'Authenticated users can modify entries'
  ) THEN
    CREATE POLICY "Authenticated users can modify entries"
    ON timetable_entries
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);
  END IF;
END $$;

-- ============================================================
-- INSTRUCTIONS FOR STORAGE BUCKET
-- ============================================================
-- You also need to create a Storage Bucket named 'timetables' in your Supabase dashboard:
-- 1. Go to Storage in Supabase Dashboard
-- 2. Click "New Bucket" -> Name it "timetables"
-- 3. Make it Public (or add RLS policies if you prefer it private)


