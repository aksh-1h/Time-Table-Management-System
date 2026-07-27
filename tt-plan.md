# University Timetable Room Assignment System — Project Plan

**Client:** Faculty of Pharmacy (FOP), Parul University
**Prepared for:** Antigravity (AI IDE) build reference

---

## 1. Problem Statement

Department timetables (PDFs) list, per division/batch, the subject and faculty assigned to each day/time slot — but **no room**. Multiple divisions run in parallel each semester, drawing from a shared, limited pool of physical rooms (general classrooms + specialized labs). The system must:

1. Extract slot data (day, time, subject, faculty, batch/division) from timetable PDFs.
2. Assign a room to every slot such that no room is double-booked at an overlapping time.
3. Respect room specialization (labs/special-purpose rooms are never handed to unrelated classes).
4. Allow manual override by an admin, with the override protected from being overwritten by future algorithm runs.
5. Present a final, clean, filterable master timetable with rooms filled in.

---

## 2. Inputs

The system relies on exactly three external inputs — no academic calendar/holiday handling is needed, since the system operates on a **recurring weekday + time pattern** (Monday/Tuesday/... + time block), not real calendar dates.

### 2.1 Room List
Provided/maintained once (and updated occasionally) via the Room Management page. Each room record includes:

| Field | Description |
|---|---|
| `room_no` | Room identifier (e.g. "303", "201B") |
| `category` | Room purpose tag — e.g. `general`, `pharmacy_practice_lab`, `instrumentation_lab` |
| `capacity` | Static numeric sanity-filter value (e.g. lab = 15, lecture = 30) — **not** matched against live batch headcounts; batches are already sized to standard room types by university convention |

### 2.2 Timetable PDFs (from university)
One PDF per division/batch/semester, structured as a day × time grid (see Section 4 for extraction details). Trusted as accurate — **no manual review/edit step for extracted data**; extraction goes straight into the database.

### 2.3 Subject → Room Requirement Mapping
A separately maintained lookup (arranged outside the PDF) mapping each subject to its required room `category` — since the timetable PDF alone doesn't reliably signal whether a subject needs a general room, a specific lab type, etc. This mapping is set up once per semester and referenced during assignment.

---

## 3. User Roles

Two functional roles, both with **equal application-level access** for v1 (no RLS role gating needed yet):

- **Superadmin** — you. Distinction lives entirely outside the app: GitHub/repo access, Supabase project ownership (service role key, migrations, dashboard access), environment/secrets, and manual creation of admin accounts via the Supabase Auth dashboard (no in-app User Management UI needed for v1).
- **Admin** — day-to-day users (e.g. department coordinators). Same in-app access as superadmin for now. Role separation can be added later (add a `role` column + RLS policy) without architectural rework.

Auth: Supabase Auth (email + password), with a "Forgot password?" link on the Login page using `supabase.auth.resetPasswordForEmail()`.

---

## 4. Frontend Pages (5 pages + Login)

| # | Page | Purpose |
|---|---|---|
| 1 | **Login** (+ forgot password) | Auth entry point |
| 2 | **Dashboard** | Status overview: timetables uploaded, slots assigned vs pending, quick links |
| 3 | **Upload** | Upload timetable PDF → auto-extract → auto-parse → store directly into `slot_assignments` (no review/edit UI — extraction is trusted) |
| 4 | **Room Management** | CRUD for room pool: `room_no`, `category`, `capacity` |
| 5 | **Timetable & Assignment** | Single page covering the full lifecycle of room assignment: <br>• "Run Assignment" trigger <br>• Conflict rows flagged red with manual room-picker override <br>• Filterable, printable final view once resolved <br>(Originally split into a "working" page and a "final view" page — merged, since the difference is a *state*, not a different page) |

---

## 5. Data Model (Supabase / Postgres)

```sql
-- rooms
rooms (
  id uuid primary key default gen_random_uuid(),
  room_no text unique not null,
  category text not null,        -- 'general' | 'pharmacy_practice_lab' | 'instrumentation_lab' | ...
  capacity int not null,
  created_at timestamptz default now()
)

-- subject_room_requirements
subject_room_requirements (
  id uuid primary key default gen_random_uuid(),
  subject text not null unique,
  required_category text not null,   -- must match a category value used in `rooms`
  created_at timestamptz default now()
)

-- slot_assignments
slot_assignments (
  id uuid primary key default gen_random_uuid(),
  division text not null,
  batch text not null,
  semester int not null,
  day text not null,                  -- 'Monday', 'Tuesday', ...
  start_time time not null,
  end_time time not null,
  subject text not null,
  faculty text not null,
  room_id uuid references rooms(id),  -- nullable until assigned
  manually_assigned boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
)

-- assignment_history (audit trail)
assignment_history (
  id uuid primary key default gen_random_uuid(),
  slot_assignment_id uuid references slot_assignments(id),
  previous_room_id uuid references rooms(id),
  new_room_id uuid references rooms(id),
  changed_by uuid references auth.users(id),
  changed_at timestamptz default now(),
  change_type text   -- 'algorithm' | 'manual'
)
```

**Note on constraints:** No simple DB-level `unique(day, time, room)` constraint is used, because time slots can partially overlap across divisions (not always exact matches). Overlap/clash prevention is handled in application logic + a transactional RPC (see Section 7.5).

---

## 6. PDF Extraction Pipeline

### 6.1 Tooling
- **Python microservice** using `pdfplumber` / `camelot-py` (lattice mode for bordered tables, stream mode for borderless). Since PDFs are native (not scanned), no OCR is needed.
- Node.js is not used for extraction — Python's table libraries detect actual grid/cell boundaries, which Node PDF libraries don't do reliably.

### 6.2 What gets extracted
Per cell in the day × time grid:
```json
{
  "day": "Monday",
  "start_time": "09:30",
  "end_time": "12:30",
  "subject": "IMA",
  "faculty": "KTP",
  "batch": "A",
  "division": "A",
  "semester": 7
}
```
- The **legend table** (subject code → full name → staff name/email) is **not** used — only the main grid is parsed, per approved scope.
- **Non-class cells are skipped** during extraction and never become `slot_assignments` rows: Recess, Assignment/Library, Weekly Test, and similar non-teaching entries.
- **Multi-line cells** (e.g. a cell containing both a class and "Assignment/Library" stacked) are split into separate logical entries; only the actual class entry is kept.
- **Multi-entry blocks** (e.g. a "Practice School" block listing several staff+room-adjacent codes for one time slot) are extracted as multiple parallel slot rows under the same time block.

### 6.3 Trust model
Extraction output is inserted directly into `slot_assignments` with no review/edit UI step — the university-provided PDF is treated as accurate and clean, per approved scope.

---

## 7. Room Assignment Algorithm

This is the core logic, run from the Timetable & Assignment page.

### 7.1 Candidate Pool Filtering (before any matching happens)

For each slot needing a room, the candidate room pool is narrowed in two stages before the assignment algorithm ever runs:

1. **Category match** — using the `subject_room_requirements` mapping, the slot's subject resolves to a `required_category`. Only rooms in `rooms` with a matching `category` are eligible. This is what prevents specialized rooms (labs, practice rooms) from ever being handed to unrelated general/theory classes — the constraint is structural (rooms are never even in the candidate list), not a rule bolted on after the fact.
2. **Capacity match** — within the category-filtered set, only rooms whose `capacity` matches the expected tier for that subject/category are eligible. This resolves the case where two rooms share a category but aren't truly interchangeable (e.g. two `pharmacy_practice_lab` rooms, one capacity 15 and one capacity 30) — capacity here is a static sanity filter, not a live headcount match.

### 7.2 Time Overlap Detection

Slots are not matched by exact `(day, time)` equality, since different divisions' slots can partially overlap rather than align exactly. Two slots conflict if they share a room AND:

```
slotA.start_time < slotB.end_time  AND  slotB.start_time < slotA.end_time
```

This interval-overlap check is used everywhere clash detection happens — both in the bulk algorithm and in manual-edit validation.

### 7.3 Assignment Logic — Lab-First, Reuse-Room Priority

**CRITICAL RULE: Labs are sacred. Never reassign lab rooms.**

Labs have HIGHER priority than classrooms. Lab rooms are permanently fixed to their subjects as defined in the room dataset. The algorithm must NEVER move a lab to a different room. Only theory/classroom assignments are flexible.

**Algorithm Priority Order:**

1. **Labs → Fixed assignment:** Lab rooms are assigned exactly as the dataset specifies (`rooms` table, category = `*_lab`). These are immutable — they are pre-assigned before the algorithm runs and are never included in the candidate pool for reassignment.
2. **Theory classrooms → Reuse-first:** Before assigning a new classroom to a theory slot, check where this `batch + subject` combination was previously held (earlier in the same semester, or in a prior run) and assign the SAME room. Only change if a time-overlap conflict makes it impossible.
3. **Fallback:** If the same room is unavailable (conflict), then and ONLY then assign an alternative classroom from the eligible pool using:
   - Greedy assignment (sort slots, sort candidate rooms, assign first available match) — sufficient at this scale.
   - Bipartite matching (simple augmenting-path) as fallback if greedy fails.
4. If a window has more eligible slots than eligible rooms (a genuine shortage), the affected slots are left with `room_id = null` and are flagged/red-highlighted in the UI — not a bug, a real scheduling conflict requiring human attention.

### 7.4 Locking — Two Distinct Mechanisms

**(a) Slot-level lock (`manually_assigned` flag on `slot_assignments`)**
Set to `true` the moment an admin manually assigns/changes a room on a specific slot. The algorithm (bulk run or re-run) always filters `WHERE manually_assigned = false`, so it never overwrites a manually fixed slot. Can be toggled back to `false` by an admin to hand a slot back to algorithmic control.

**(b) Room-level structural restriction (category tagging on `rooms`)**
Specialized rooms are permanently excluded from general use via their `category` tag (Section 7.1), not via a per-slot manual lock. This avoids requiring an admin to manually pre-lock every special-room slot, every semester, for every division — the constraint is enforced once, at the room level, and holds automatically.

### 7.5 Manual Edit Validation (validate-on-write)

When an admin manually sets/changes `room_id` on a slot:

1. Query all other slots that **time-overlap** (7.2) and share the same `room_id`.
2. If any conflict found → reject the save; surface which division/slot is conflicting.
3. If clean → save, set `manually_assigned = true`, and write a row to `assignment_history` (`change_type: 'manual'`, `changed_by`, previous/new room).
4. This check-and-write is implemented as a **single Postgres RPC function** (not two separate client calls), wrapped in a transaction using `SELECT ... FOR UPDATE` on the relevant overlapping rows — this closes the race-condition window that a plain DB unique constraint can't cover here (since overlap isn't exact-match equality). This also protects against **concurrent edits**: if two admins try to assign conflicting rooms to overlapping slots simultaneously, the second transaction's row lock forces it to wait and then correctly fail/re-check against the first's committed change.

### 7.6 Re-running Assignment (incremental, never global-overwrite)

Re-running the algorithm never re-solves the entire dataset from scratch (which would silently shuffle rooms on slots that were already fine, breaking admin trust). Instead, every run — whether triggered by a new PDF upload or an explicit "Re-run Assignment" click — only targets:

```
WHERE room_id IS NULL AND manually_assigned = false
```

Already-locked (manual) and already-resolved slots are left untouched. Already-assigned rooms occupying a given time window are still counted as "taken" when filtering candidate rooms for newly-added slots.

### 7.7 Audit Trail

Every room change — whether from an algorithm run or a manual edit — writes a row to `assignment_history`, capturing previous room, new room, who changed it (for manual changes), when, and the change type. This is retained for traceability; no rollback UI is built for v1, but the data needed for one is preserved.

### 7.8 Faculty Clash Detection

A faculty member can teach multiple subjects across different semesters/divisions (e.g. Faculty A teaches Subject X in Sem 1 and Subject Y in Sem 5). The system must ensure the same faculty is never scheduled for two overlapping slots, regardless of which rooms are involved.

- **No new input needed** — the `faculty` field is already captured per slot during PDF extraction (Section 6.2), so this check requires no additional data source.
- **Detection logic** — identical interval-overlap check used for rooms (Section 7.2), grouped by `faculty` instead of `room_id`:
  ```
  slotA.faculty == slotB.faculty
  AND slotA.start_time < slotB.end_time
  AND slotB.start_time < slotA.end_time
  ```
- **When this runs** — immediately after PDF extraction/upload, independent of and prior to room assignment. A faculty double-booking is an error in the source timetable data itself (e.g. two divisions' PDFs both list the same faculty at an overlapping time), not something room assignment causes or resolves — so it must be surfaced right at ingestion, not buried inside the room-assignment step.
- **Surfacing conflicts** — flagged faculty clashes are shown similarly to room conflicts (red-highlighted), but as a distinct conflict type ("Faculty conflict" vs "Room conflict") so admins aren't confused about which kind of problem they're looking at and what fixes it (a faculty clash requires the department to correct the source timetable/schedule, not a room reassignment).

---

## 8. Tech Stack Summary

| Layer | Technology |
|---|---|
| PDF table extraction | Python + `pdfplumber` / `camelot-py` |
| Backend / API | Node.js + Express |
| Database + Auth | Supabase (Postgres, Supabase Auth) |
| Assignment algorithm | Plain JS (Express) — greedy first, simple bipartite matching fallback |
| Manual-edit validation & concurrency safety | Postgres RPC function (transaction + row lock) |
| Frontend | Next.js + React |

---

## 9. Explicitly Out of Scope (v1)

- Extraction review/edit UI (PDF data trusted as-is on upload)
- Legend-table parsing (subject/staff full-name resolution)
- Live per-batch headcount vs room capacity matching (capacity is a static room-level sanity filter only)
- Academic calendar / holiday-date exclusion (system is weekday+time recurring pattern only, no real dates)
- Role-based access control / User Management UI (superadmin vs admin distinction is infra-level only, not app-level, for v1)
- Rollback UI for assignment history (data is preserved for future use, but no UI built now)
