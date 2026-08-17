-- ============================================================
-- TT-FOP Migration 003: Parsing Score Columns
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- ============================================================

-- Add overall parsing score to the uploads table
ALTER TABLE timetable_uploads
  ADD COLUMN IF NOT EXISTS overall_parsing_score NUMERIC DEFAULT 0;

-- Add per-entry parsing score to the entries table
ALTER TABLE timetable_entries
  ADD COLUMN IF NOT EXISTS parsing_score NUMERIC DEFAULT 0;

-- ============================================================
-- INSTRUCTIONS
-- ============================================================
-- Run the above ALTER TABLE statements in your Supabase SQL Editor
-- to add the parsing_score columns. These columns store the
-- confidence score (0–100) calculated by the parser service.
--
-- The overall_parsing_score on timetable_uploads is the mean
-- of all entry parsing_scores for that upload.
