# UI Design Brief — Timetable Room Assignment System
**For: Stitch AI UI generation**

---

## 1. Product Context

This is an internal tool used by 1–3 department coordinators at a university's Faculty of Pharmacy to upload timetable PDFs and auto-assign classrooms/labs to every class slot, avoiding double-bookings and respecting lab-only rooms. It is a **utility/admin tool**, not a marketing or consumer product — used repeatedly, briefly, at the start of each semester and whenever conflicts need resolving. The design priority is clarity and speed of scanning data, not visual flourish.

## 2. Design Direction

**Aesthetic:** Calm, precise, institutional-but-modern — closer to a well-designed operations dashboard (think air-traffic scheduling or hospital bed-management tools) than a marketing site. Avoid generic AI-tool defaults: no cream-background/terracotta-accent look, no near-black-with-neon-accent look, no broadsheet/newspaper styling. This is a data-and-decisions tool — the design should feel like a precision instrument, not a brand page.

**Color palette** (4–6 named values):
- `--ink` `#1C2333` — primary text, near-black navy, not pure black
- `--paper` `#FAFBFC` — page background, soft off-white, not stark white
- `--slate` `#5B6478` — secondary text, labels, muted UI chrome
- `--signal-blue` `#2F5EFF` — primary action color (buttons, links, active states)
- `--conflict-red` `#E5484D` — reserved exclusively for room conflicts/unresolved slots — never used decoratively elsewhere, so it stays meaningful
- `--confirm-green` `#1E9E6B` — successful assignment / resolved state

**Typography:**
- Display/headings: a clean grotesk with slightly condensed width for density (e.g. Inter Tight, IBM Plex Sans Condensed, or similar) — used for page titles and table headers only, restrained weight use (600 max)
- Body/UI text: a highly legible neutral sans (e.g. Inter, IBM Plex Sans) at 14–15px base for dense tables
- Data/monospace: a monospace or tabular-figure font for room numbers, times, and codes (e.g. IBM Plex Mono or tabular-nums variant) — so numbers align cleanly in columns, which matters a lot for a timetable grid

**Layout concept:**
- Persistent left sidebar navigation (icons + labels) for the 5 pages, since users will jump between Upload → Room Management → Assignment often in one sitting
- Content area uses a consistent page header (title + one primary action button, top-right) across all pages
- Tables/grids are the dominant UI element throughout — treat them as first-class, not an afterthought bolted onto a "nicer" layout

**Signature element:** The day×time grid itself — styled as a clean, color-coded matrix (not a plain HTML table look) where each cell's left border color reflects its state (grey = unassigned, green = auto-assigned, blue = manually locked, red = conflict). This recurring color-coded cell language is what should make the product feel considered and legible at a glance, and it repeats consistently across the Assignment page and Master Timetable view.

**Motion:** Minimal and functional only — a brief fade/slide when a conflict resolves, a subtle pulse on newly-flagged conflict rows. No decorative animation; this tool should feel instant and calm, not showy.

**Density & accessibility:** Comfortable but compact spacing (this is a data tool, not a landing page) — visible keyboard focus states throughout, sufficient contrast on all status colors, responsive down to tablet width at minimum (mobile is a lower priority given the use case, but shouldn't break).

---

## 3. Pages

### 3.1 Login (+ Forgot Password)
- Centered single-card layout on the `--paper` background, no split-screen marketing imagery — keep it minimal since this is an internal tool, not a public product
- Fields: Email, Password, "Log in" primary button (signal-blue)
- "Forgot password?" text link below the form, opens a lightweight secondary state (same card, swapped content) asking for email to send a reset link — no separate full-page navigation needed
- Institution name/logo mark at the top of the card (Parul University / Faculty of Pharmacy), small and unobtrusive

### 3.2 Dashboard
- Page header: "Dashboard" + primary action button "Upload timetable" (top-right, jumps to Upload)
- Row of 3–4 compact stat cards near the top: **Divisions loaded**, **Total slots**, **Assigned**, **Unresolved conflicts** (this last one in conflict-red if > 0, otherwise in confirm-green with a checkmark)
- Below the stat cards: a simple list/table of recently uploaded timetables (division, semester, upload date, status badge: Assigned / Partial / Conflicts)
- Secondary shortcut links/cards: "Run Assignment" → jumps to Timetable & Assignment page; "Manage Rooms" → jumps to Room Management

### 3.3 Upload
- Page header: "Upload Timetable"
- Large, centered drag-and-drop zone (dashed border, upload icon, "Drop PDF here or click to browse") — single-purpose page, minimal chrome around it
- Below the drop zone: a compact processing state — spinner + status text ("Extracting slots…" → "42 slots imported for Division A, Semester 7") — no editable review table, since extraction is trusted as-is per product decision
- On success: confirmation banner (confirm-green) with a direct link to view the newly imported slots on the Timetable & Assignment page

### 3.4 Room Management
- Page header: "Rooms" + primary action button "Add room" (opens a small modal/side-panel form: Room No, Category dropdown, Capacity number field)
- Main content: a clean table — columns: Room No, Category (shown as a small colored pill/tag per category type), Capacity, Actions (edit/delete icons)
- Filter/search bar above the table (filter by category) since the list may grow across multiple lab types
- Category pills should each get a consistent, distinct but muted color (not full-saturation) so they're scannable without competing with the conflict-red/confirm-green status language used elsewhere

### 3.5 Timetable & Assignment
This is the most complex page — the core working surface.

- Page header: "Timetable & Assignment" + primary action button "Run assignment" (signal-blue) + secondary filter controls (Division, Semester dropdowns)
- **View toggle** near the top: Grid view (day × time matrix, matching the familiar physical-timetable layout) vs. List view (flat sortable table: Day, Time, Division, Subject, Faculty, Room, Status) — both should be available since some conflicts are easier to spot in list form, while the grid is more intuitive for a general read
- **Grid view:** each cell shows subject + faculty + room (once assigned), with the left-border color language from the signature element (grey/green/blue/red per state described above). Clicking a cell opens a small popover: current room, a dropdown to manually reassign, and a "Lock" toggle (reflecting `manually_assigned`)
- **Conflict handling:** unresolved slots are visually pulled forward — either a "Conflicts (n)" tab/filter at the top that jumps straight to just those rows, or a persistent red-bordered section above the main grid listing only unresolved slots with an inline room-picker to fix each one on the spot
- Status legend fixed at the top or bottom of this view, small and unobtrusive: grey dot "Unassigned," green dot "Auto-assigned," blue dot "Manually locked," red dot "Conflict"

---

## 4. Copy & Voice Guidance

- Buttons name the action directly and keep that name through the whole flow: "Run assignment" → success toast reads "Assignment complete," not "Success!"
- Conflict messages state exactly what happened and where, in plain terms: "Room 204 is already assigned to Division B at this time" — never vague ("Something went wrong") and never apologetic
- Empty states are instructional, not decorative: an empty Room Management table reads "No rooms added yet — add your first room to begin assigning classes," with the "Add room" button right there
- Avoid system/implementation language in the UI: say "room," "slot," "conflict," never "row," "record," "null value"
