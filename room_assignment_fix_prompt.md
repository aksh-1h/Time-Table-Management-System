# Prompt for Antigravity — Fix Room Assignment Architecture

## Problem

Right now, the room assignment ("Run Assignment") is being triggered separately for each individual semester + division combination (e.g. Sem 1 Div A, then Sem 3 Div B, etc.), one click at a time.

This is causing a structural problem, not just a performance one:

- Room allocation is a shared-resource problem — every batch (across every course, semester, and division) is competing for the same limited pool of rooms across the same limited pool of time slots.
- When each batch is assigned independently, the system assigning rooms for Sem 1 Div A has zero knowledge of what Sem 3 Div B (or any other batch) will need afterward.
- Whichever batch happens to run first ends up grabbing rooms/slots that might be needed for a better overall arrangement later. The order of clicking "Run" ends up determining who gets good rooms and who gets stuck with none — this is not stable or predictable behavior.
- By the time later batches are assigned, there may be no valid rooms/slots left for them even though a better global arrangement exists — this is the root cause of the lag/conflict issue currently being seen.

This is essentially a timetabling / constraint-satisfaction problem, and these types of problems require seeing **all constraints at once** to reliably produce a valid (or optimal) solution. Solving it piece by piece, batch by batch, is fundamentally the wrong approach and is why the current system is struggling.

## Required Fix

Restructure the room assignment system so that it collects all relevant data first, and then solves the assignment globally in a single pass — instead of solving it separately per batch.

### 1. Data Collection Phase
Before running any assignment, the system should gather the full set of class requirements (theory/practical class counts, durations, batch sizes, course/sem/division identity) for **all the batches that need to be scheduled together** — not just the one currently selected. The user should be able to select the scope they want scheduled (for example: all odd semesters at once, or a custom multi-select of sem/division combinations) rather than being limited to one sem + one division at a time.

### 2. Single Global Solve
There should be one unified assignment run that solves for the entire selected dataset at once. The assignment logic must treat rooms and time slots as a single shared grid (room × day × hour, across all courses/sems/divisions being scheduled) so that no two classes from any batch can ever be double-booked into the same room at the same time. This replaces the current one-button-per-batch approach with a single "Generate Timetable" action that covers everything selected.

### 3. Persistent Global Occupancy Tracking
The system should maintain a persistent record of which room is occupied by which class, at which day/time slot, across all batches — this is the single source of truth for what is already assigned. Every assignment run (full or partial) should read from and write to this same shared record, so batches are never assigned in isolation without knowledge of what else has already been scheduled.

### 4. Support Two Modes of Operation
- **Full Generation**: Clears and recomputes the assignment for all selected semesters/divisions together, using the global solve described above. This is the primary, reliable option that avoids conflicts and should be the main path used.
- **Scoped Regeneration**: Allows regenerating the assignment for just one specific batch/division without touching everyone else's already-assigned rooms. In this mode, every other batch's existing room/time assignments should be treated as fixed and unavailable, and only the selected batch's classes should be re-solved against the remaining free space. This mode should be clearly understood (and communicated to the user in the interface) as more limited than a full regeneration — it may fail to find valid rooms/slots even in cases where a full regeneration would succeed, because it is constrained by everyone else's fixed assignments.

### 5. Why Both Modes Matter
The full generation mode is what actually prevents the room conflicts and instability currently happening, and should be treated as the authoritative/default way to build the timetable. The scoped regeneration mode is a convenience for making small tweaks to a single batch without regenerating the entire institution's timetable, but it should never be the primary way assignments are created, since it does not have visibility into the full picture.

## Summary of What Needs to Change
- Stop treating each semester/division as an independent assignment run with no shared awareness of other batches.
- Introduce a data collection step that gathers requirements for all batches being scheduled together before any assignment logic runs.
- Introduce a single global assignment solve that considers all batches' room and time slot needs simultaneously, using one shared occupancy grid.
- Maintain a persistent shared record of all current room/time assignments across every batch, which all future runs (full or partial) must respect.
- Keep a full regeneration option as the primary, reliable path, and a scoped/partial regeneration option as a secondary convenience feature only, with its limitations made clear.
