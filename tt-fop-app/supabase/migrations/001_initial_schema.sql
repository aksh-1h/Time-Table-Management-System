-- ============================================================
-- TT-FOP Initial Schema — Rooms, Faculties, Subjects
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- ============================================================

-- Enable UUID generator before any tables use gen_random_uuid()
create extension if not exists pgcrypto;

-- ─── ROOMS ──────────────────────────────────────────────────
create table if not exists rooms (
  id UUID primary key default gen_random_uuid (),
  room_no TEXT unique not null,
  room_name TEXT not null,
  category TEXT not null,
  program TEXT,
  capacity INT default 0,
  is_active BOOLEAN default true,
  created_at TIMESTAMPTZ default now(),
  updated_at TIMESTAMPTZ default now()
);

-- ─── FACULTIES ──────────────────────────────────────────────
create table if not exists faculties (
  id UUID primary key default gen_random_uuid (),
  name TEXT not null,
  designation TEXT,
  is_active BOOLEAN default true,
  created_at TIMESTAMPTZ default now(),
  unique (name)
);

-- ─── SUBJECTS ───────────────────────────────────────────────
create table if not exists subjects (
  id uuid primary key default gen_random_uuid (),
  subject_code text not null,
  subject_name text not null,
  program text not null,
  specialization text,
  semester int,
  class_type text not null default 'theory',
  created_at timestamptz default now(),
  specialization_norm text generated always as (coalesce(specialization, '')) stored,
  unique (
    subject_code,
    class_type,
    program,
    specialization_norm
  )
);

-- ─── FACULTY ↔ SUBJECT ASSIGNMENTS ─────────────────────────
create table if not exists faculty_subject_assignments (
  id UUID primary key default gen_random_uuid (),
  faculty_id UUID references faculties (id) on delete CASCADE,
  subject_id UUID references subjects (id) on delete CASCADE,
  division TEXT,
  role TEXT default 'instructor',
  academic_year TEXT default '2026-27',
  created_at TIMESTAMPTZ default now()
);

-- ─── SUBJECT → ROOM REQUIREMENTS ───────────────────────────
create table if not exists subject_room_requirements (
  id UUID primary key default gen_random_uuid (),
  subject_id UUID references subjects (id) on delete CASCADE,
  required_category TEXT not null,
  created_at TIMESTAMPTZ default now(),
  unique (subject_id)
);

-- ─── SLOT ASSIGNMENTS (for timetable data — uploaded later) ──
create table if not exists slot_assignments (
  id UUID primary key default gen_random_uuid (),
  division TEXT not null,
  batch TEXT not null,
  semester INT not null,
  day TEXT not null,
  start_time TIME not null,
  end_time TIME not null,
  subject TEXT not null,
  faculty TEXT not null,
  room_id UUID references rooms (id),
  manually_assigned BOOLEAN default false,
  created_at TIMESTAMPTZ default now(),
  updated_at TIMESTAMPTZ default now()
);

-- ─── ASSIGNMENT HISTORY (audit trail) ───────────────────────
create table if not exists assignment_history (
  id UUID primary key default gen_random_uuid (),
  slot_assignment_id UUID references slot_assignments (id),
  previous_room_id UUID references rooms (id),
  new_room_id UUID references rooms (id),
  changed_by UUID,
  changed_at TIMESTAMPTZ default now(),
  change_type TEXT
);

-- ─── INDEXES ────────────────────────────────────────────────
create index if not exists idx_rooms_category on rooms (category);
create index if not exists idx_rooms_program on rooms (program);

create index if not exists idx_subjects_program on subjects (program);
create index if not exists idx_subjects_semester on subjects (semester);

create index if not exists idx_faculty_assignments_faculty on faculty_subject_assignments (faculty_id);
create index if not exists idx_faculty_assignments_subject on faculty_subject_assignments (subject_id);

create index if not exists idx_slot_assignments_day_time on slot_assignments (day, start_time, end_time);
create index if not exists idx_slot_assignments_room on slot_assignments (room_id);

-- ─── RLS POLICIES (permissive for v1 — all authenticated users) ──
alter table rooms ENABLE row LEVEL SECURITY;
alter table faculties ENABLE row LEVEL SECURITY;
alter table subjects ENABLE row LEVEL SECURITY;
alter table faculty_subject_assignments ENABLE row LEVEL SECURITY;
alter table subject_room_requirements ENABLE row LEVEL SECURITY;
alter table slot_assignments ENABLE row LEVEL SECURITY;
alter table assignment_history ENABLE row LEVEL SECURITY;

-- Allow all authenticated users full access (v1 — no role distinction)

drop policy if exists "Authenticated users can read rooms" on rooms;
create policy "Authenticated users can read rooms" on rooms for
select to authenticated using (true);

drop policy if exists "Authenticated users can modify rooms" on rooms;
create policy "Authenticated users can modify rooms" on rooms for all to authenticated using (true)
with check (true);

drop policy if exists "Authenticated users can read faculties" on faculties;
create policy "Authenticated users can read faculties" on faculties for
select to authenticated using (true);

drop policy if exists "Authenticated users can modify faculties" on faculties;
create policy "Authenticated users can modify faculties" on faculties for all to authenticated using (true)
with check (true);

drop policy if exists "Authenticated users can read subjects" on subjects;
create policy "Authenticated users can read subjects" on subjects for
select to authenticated using (true);

drop policy if exists "Authenticated users can modify subjects" on subjects;
create policy "Authenticated users can modify subjects" on subjects for all to authenticated using (true)
with check (true);

drop policy if exists "Authenticated users can read assignments" on faculty_subject_assignments;
create policy "Authenticated users can read assignments" on faculty_subject_assignments for
select to authenticated using (true);

drop policy if exists "Authenticated users can modify assignments" on faculty_subject_assignments;
create policy "Authenticated users can modify assignments" on faculty_subject_assignments for all to authenticated using (true)
with check (true);

drop policy if exists "Authenticated users can read subject_room_requirements" on subject_room_requirements;
create policy "Authenticated users can read subject_room_requirements" on subject_room_requirements for
select to authenticated using (true);

drop policy if exists "Authenticated users can modify subject_room_requirements" on subject_room_requirements;
create policy "Authenticated users can modify subject_room_requirements" on subject_room_requirements for all to authenticated using (true)
with check (true);

drop policy if exists "Authenticated users can read slot_assignments" on slot_assignments;
create policy "Authenticated users can read slot_assignments" on slot_assignments for
select to authenticated using (true);

drop policy if exists "Authenticated users can modify slot_assignments" on slot_assignments;
create policy "Authenticated users can modify slot_assignments" on slot_assignments for all to authenticated using (true)
with check (true);

drop policy if exists "Authenticated users can read assignment_history" on assignment_history;
create policy "Authenticated users can read assignment_history" on assignment_history for
select to authenticated using (true);

drop policy if exists "Authenticated users can modify assignment_history" on assignment_history;
create policy "Authenticated users can modify assignment_history" on assignment_history for all to authenticated using (true)
with check (true);