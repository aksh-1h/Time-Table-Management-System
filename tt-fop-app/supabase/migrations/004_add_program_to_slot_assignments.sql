-- Migration 004: Add program column to slot_assignments
-- 
-- The slot_assignments table was missing the 'program' column, which is needed
-- to correctly scope assignment operations per academic program (B.Pharm, M.Pharm, Pharm D).
-- Without this column, delete operations during re-assignment could wipe assignments
-- across different programs that share the same semester number.

-- Add program column (nullable for backward compatibility with existing rows)
ALTER TABLE slot_assignments ADD COLUMN IF NOT EXISTS program TEXT;

-- Backfill existing rows: default to empty string so they're not NULL
UPDATE slot_assignments SET program = '' WHERE program IS NULL;

-- Make it NOT NULL going forward
ALTER TABLE slot_assignments ALTER COLUMN program SET NOT NULL;
ALTER TABLE slot_assignments ALTER COLUMN program SET DEFAULT '';

-- Add index for scoped queries
CREATE INDEX IF NOT EXISTS idx_slot_assignments_program ON slot_assignments (program);

-- Add composite index for the common query pattern (program + semester + division)
CREATE INDEX IF NOT EXISTS idx_slot_assignments_scope ON slot_assignments (program, semester, division);
