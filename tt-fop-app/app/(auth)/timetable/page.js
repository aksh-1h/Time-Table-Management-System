'use client';
import { useState, useEffect, useMemo, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const BPHARM_BATCHES = ['A', 'B', 'C', 'D'];

// Distinct colors for each batch
const BATCH_COLORS = {
  'A': { bg: 'rgba(59,130,246,0.10)', border: 'rgba(59,130,246,0.35)', text: '#2563eb', dot: '#3b82f6' },
  'B': { bg: 'rgba(16,185,129,0.10)', border: 'rgba(16,185,129,0.35)', text: '#059669', dot: '#10b981' },
  'C': { bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.35)', text: '#d97706', dot: '#f59e0b' },
  'D': { bg: 'rgba(168,85,247,0.10)', border: 'rgba(168,85,247,0.35)', text: '#7c3aed', dot: '#a855f7' },
};

function formatTime(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':');
  return `${parseInt(h)}:${m}`;
}

function formatTimeRange(start, end) {
  return `${formatTime(start)} - ${formatTime(end)}`;
}

/**
 * Detect consecutive lab groups: groups of 3 consecutive practical slots
 * for the same batch+subject on the same day.
 * Returns a Map: "day|batch|firstPeriodStart" → { slots: [3 slots], rowSpan: 3 }
 */
function buildLabGroups(slots) {
  // Group practical slots by day+batch
  const practicalsByDayBatch = {};
  for (const s of slots) {
    if (s.class_type !== 'practical' || !BPHARM_BATCHES.includes(s.batch)) continue;
    const key = `${s.day}|${s.batch}`;
    if (!practicalsByDayBatch[key]) practicalsByDayBatch[key] = [];
    practicalsByDayBatch[key].push(s);
  }

  const labGroups = new Map(); // "day|startTime" → { batches: { batchLetter: { slots, subject, faculty, room } } }
  const spannedCells = new Set(); // "day|startTime" entries that should be skipped (2nd and 3rd rows)

  for (const [key, practicals] of Object.entries(practicalsByDayBatch)) {
    const [day, batch] = key.split('|');

    // Sort by start_time
    practicals.sort((a, b) => a.start_time.localeCompare(b.start_time));

    // Find groups of 3 consecutive slots with the same subject
    let i = 0;
    while (i < practicals.length) {
      // Try to form a group of 3
      if (i + 2 < practicals.length) {
        const s1 = practicals[i];
        const s2 = practicals[i + 1];
        const s3 = practicals[i + 2];

        // Check if consecutive and same subject
        if (s1.subject === s2.subject && s2.subject === s3.subject &&
            s1.end_time === s2.start_time && s2.end_time === s3.start_time) {
          // Found a 3-slot lab group
          const groupKey = `${day}|${s1.start_time}–${s1.end_time}`;

          if (!labGroups.has(groupKey)) {
            labGroups.set(groupKey, { day, batches: {} });
          }
          labGroups.get(groupKey).batches[batch] = {
            slots: [s1, s2, s3],
            subject: s1.subject,
            faculty: s1.faculty,
            room: s1.room,
            room_id: s1.room_id,
            faculty_conflict: s1.faculty_conflict,
            faculty_conflict_detail: s1.faculty_conflict_detail,
          };

          // Mark the 2nd and 3rd time rows as spanned for this day
          spannedCells.add(`${day}|${s2.start_time}–${s2.end_time}`);
          spannedCells.add(`${day}|${s3.start_time}–${s3.end_time}`);

          i += 3;
          continue;
        }
      }
      i++;
    }
  }

  return { labGroups, spannedCells };
}


function TimetableContent() {
  const searchParams = useSearchParams();

  // Initialize from URL params (from the "View Timetable" button)
  const [program, setProgram] = useState(searchParams.get('program') || 'B.Pharm');
  const [semester, setSemester] = useState(searchParams.get('semester') || '1');
  const [division, setDivision] = useState(searchParams.get('division') || 'A');
  const isOriginal = searchParams.get('original') === 'true';
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'assigned' | 'unassigned'

  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [options, setOptions] = useState({ programs: [], semesters: [], divisions: [] });

  // ── Fetch filter options ──
  useEffect(() => {
    fetch('/api/slots/options')
      .then(res => res.json())
      .then(data => {
        if (data.programs) setOptions(prev => ({ ...prev, programs: data.programs }));
        if (data.semesters) setOptions(prev => ({ ...prev, semesters: data.semesters }));
        if (data.divisions) setOptions(prev => ({ ...prev, divisions: data.divisions }));
      })
      .catch(err => console.error("Error loading filter options:", err));
  }, []);

  // ── Fetch slots for the selected combination ──
  const fetchSlots = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('program', program);
      params.set('semester', semester);
      params.set('division', division);
      const res = await fetch(`/api/slots?${params}`);
      if (!res.ok) throw new Error('Failed to fetch timetable');
      const data = await res.json();
      setSlots(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [program, semester, division]);

  useEffect(() => {
    fetchSlots();
  }, [fetchSlots]);

  // ── Derive unique time periods (deduplicated) ──
  const timeSlots = useMemo(() => {
    const times = new Set();
    for (const s of slots) times.add(`${s.start_time}–${s.end_time}`);
    return [...times].sort();
  }, [slots]);

  // ── Build lab groups for visual merging ──
  const { labGroups, spannedCells } = useMemo(() => buildLabGroups(slots), [slots]);

  // ── Get single slot at a given day/time (for theory/non-batch) ──
  const getSlot = useCallback((day, time) => {
    const slot = slots.find(s =>
      s.day === day &&
      `${s.start_time}–${s.end_time}` === time &&
      !BPHARM_BATCHES.includes(s.batch)
    );
    if (!slot) return null;
    if (slot.is_recess || slot.class_type === 'recess') return slot;

    if (statusFilter === 'assigned' && !slot.room_id) return null;
    if (statusFilter === 'unassigned' && slot.room_id) return null;
    return slot;
  }, [slots, statusFilter]);

  // ── Get batch practical slots for a given day/time (non-merged fallback) ──
  const getBatchSlots = useCallback((day, time) => {
    let allowedBatches = BPHARM_BATCHES;
    if (program === 'B.Pharm') {
      if (division === 'A') allowedBatches = ['A', 'B'];
      if (division === 'B') allowedBatches = ['C', 'D'];
    }

    return slots.filter(s =>
      s.day === day &&
      `${s.start_time}–${s.end_time}` === time &&
      s.class_type === 'practical' &&
      allowedBatches.includes(s.batch)
    ).filter(s => {
      if (statusFilter === 'assigned') return !!s.room_id;
      if (statusFilter === 'unassigned') return !s.room_id;
      return true;
    });
  }, [slots, program, division, statusFilter]);

  // ── Visible days ──
  const visibleDays = DAYS.filter(d => slots.some(s => s.day === d));

  // ── Stats ──
  const stats = useMemo(() => {
    const nonRecess = slots.filter(s => !s.is_recess && s.class_type !== 'recess');
    const assigned = nonRecess.filter(s => s.room_id).length;
    const unassigned = nonRecess.filter(s => !s.room_id).length;
    return { assigned, unassigned, total: nonRecess.length };
  }, [slots]);

  // ── Check if any schedule exists ──
  const noSchedule = !loading && slots.length === 0;

  return (
    <>
      <div className="page-header">
        <div className="page-header-left">
          <h1>{isOriginal ? 'Original Uploaded Timetable' : 'View Timetable'}</h1>
          <p>{isOriginal ? 'Showing the timetable structure exactly as uploaded (no rooms assigned)' : 'Optimized timetable with assigned rooms'} · {program} · {program === 'Pharm D' ? 'Year' : 'Sem'} {semester} {program === 'B.Pharm' && `· Div ${division}`}</p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <select className="filter-select" value={program} onChange={e => { setProgram(e.target.value); setSemester('1'); setDivision('A'); }}>
            {(options.programs.length > 0 ? options.programs : ['B.Pharm', 'M.Pharm', 'Pharm D']).map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <select className="filter-select" value={semester} onChange={e => setSemester(e.target.value)}>
            {(
              program === 'M.Pharm' ? [1, 2, 3, 4] :
              program === 'Pharm D' ? [1, 2, 3, 4, 5] :
              [1, 2, 3, 4, 5, 6, 7, 8]
            ).map(s => (
              <option key={s} value={s}>{program === 'Pharm D' ? `Year ${s}` : `Semester ${s}`}</option>
            ))}
          </select>
          <select className="filter-select" value={division} onChange={e => setDivision(e.target.value)}>
            {(options.divisions.length > 0 ? options.divisions : ['A', 'B']).map(d => (
              <option key={d} value={d}>Division {d}</option>
            ))}
          </select>
          <select className="filter-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="all">All Status</option>
            <option value="assigned">Assigned Only</option>
            <option value="unassigned">Unassigned Only</option>
          </select>
          <button className="btn btn-ghost" onClick={fetchSlots} title="Refresh">
            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
            </svg>
          </button>
          {!isOriginal && (
            <Link href="/generate" className="btn btn-secondary">
              <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
              </svg>
              Run Assignment
            </Link>
          )}
        </div>
      </div>

      <div className="page-body">
        {/* Quick stats */}
        {!loading && slots.length > 0 && !isOriginal && (
          <div style={{ display: 'flex', gap: '16px', marginBottom: '20px', flexWrap: 'wrap' }}>
            <div className="tt-stat-pill">
              <span className="tt-stat-pill-dot" style={{ background: 'var(--confirm-green)' }} />
              {stats.assigned} assigned
            </div>
            <div className="tt-stat-pill">
              <span className="tt-stat-pill-dot" style={{ background: stats.unassigned > 0 ? 'var(--conflict-red)' : '#b0b4c0' }} />
              {stats.unassigned} unassigned
            </div>
            <div className="tt-stat-pill">
              <span className="tt-stat-pill-dot" style={{ background: 'var(--signal-blue)' }} />
              {stats.total} total
            </div>
          </div>
        )}

        {error && (
          <div className="alert alert-error" style={{ marginBottom: '16px' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="card" style={{ textAlign: 'center', padding: '64px' }}>
            <div className="pulse" style={{ marginBottom: '16px' }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--signal-blue)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/>
                <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/>
                <line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/>
                <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>
              </svg>
            </div>
            <div className="headline-md">Loading timetable…</div>
          </div>
        ) : noSchedule ? (
          <div className="card">
            <div className="empty-state">
              <div className="empty-state-icon">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
              </div>
              <div className="empty-state-title">No timetable uploaded</div>
              <p style={{ fontSize: '13px', color: 'var(--slate)', marginBottom: '16px' }}>
                No schedule data found for {program} {program === 'Pharm D' ? `Year ${semester}` : `Semester ${semester}`} Division {division}. 
                Upload the timetable first.
              </p>
              <Link href="/upload" className="btn btn-primary btn-sm">Upload Timetable</Link>
            </div>
          </div>
        ) : (
          /* ── The Timetable Grid ── */
          <div className="card tt-card" style={{ padding: 0, overflow: 'auto' }}>
            <table className="data-table tt-grid">
              <thead>
                <tr>
                  <th className="tt-time-header">TIME</th>
                  {visibleDays.map(d => <th key={d} className="tt-day-header">{d.toUpperCase()}</th>)}
                </tr>
              </thead>
              <tbody>
                {timeSlots.map((time, timeIdx) => {
                  const [startT, endT] = time.split('–');
                  const isRecess = startT === '12:30:00';

                  return (
                    <tr key={time} className={isRecess ? 'tt-recess-row' : ''}>
                      <td className="tt-time-cell mono">{formatTimeRange(startT, endT)}</td>
                      {visibleDays.map(day => {
                        // Check for recess
                        if (isRecess) {
                          return (
                            <td key={day} className="tt-recess-cell">
                              <div className="tt-recess-label">RECESS</div>
                            </td>
                          );
                        }

                        // Check if this cell is spanned by a lab group from a previous row
                        const cellKey = `${day}|${time}`;
                        if (spannedCells.has(cellKey)) {
                          return null; // Spanned by rowSpan from above
                        }

                        // Check if this is the START of a lab group
                        const labGroupKey = `${day}|${time}`;
                        const labGroup = labGroups.get(labGroupKey);
                        if (labGroup && Object.keys(labGroup.batches).length > 0) {
                          const batchEntries = Object.entries(labGroup.batches);
                          return (
                            <td key={day} rowSpan={3} style={{ padding: 0, verticalAlign: 'top' }}>
                              <div className="tt-lab-merged-container">
                                {batchEntries.map(([batchLetter, batchData]) => {
                                  const colors = BATCH_COLORS[batchLetter] || BATCH_COLORS['A'];
                                  return (
                                    <div
                                      key={batchLetter}
                                      className="tt-lab-merged-batch"
                                      style={{
                                        background: colors.bg,
                                        borderLeft: `3px solid ${colors.dot}`,
                                      }}
                                    >
                                      <div className="tt-batch-header">
                                        <span className="tt-batch-label" style={{ color: colors.text }}>
                                          BATCH {batchLetter}
                                        </span>
                                        {!isOriginal && batchData.room && (
                                          <span className="tt-batch-room" style={{ color: colors.text }}>
                                            {batchData.room.room_no}
                                          </span>
                                        )}
                                      </div>
                                      <div className="tt-batch-subject">{batchData.subject}</div>
                                      <div className="tt-batch-faculty">{batchData.faculty}</div>
                                      {!isOriginal && !batchData.room_id && (
                                        <div className="tt-slot-no-room" style={{ marginTop: '4px' }}>— No room</div>
                                      )}
                                      {batchData.faculty_conflict && (
                                        <div className="tt-faculty-conflict-badge" title={batchData.faculty_conflict_detail}>
                                          ⚠️ Faculty clash
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </td>
                          );
                        }

                        // Check for non-merged batch-level practical slots (fallback)
                        const batchSlots = getBatchSlots(day, time);
                        if (batchSlots.length > 0) {
                          return (
                            <td key={day} style={{ padding: 0 }}>
                              <div className="tt-batch-container">
                                {batchSlots.map(bs => {
                                  const colors = BATCH_COLORS[bs.batch] || BATCH_COLORS['A'];
                                  return (
                                    <div
                                      key={bs.id}
                                      className="tt-batch-item"
                                      style={{
                                        background: colors.bg,
                                        borderLeft: `3px solid ${colors.dot}`,
                                      }}
                                    >
                                      <div className="tt-batch-header">
                                        <span className="tt-batch-label" style={{ color: colors.text }}>
                                          Batch {bs.batch}
                                        </span>
                                        {!isOriginal && bs.room && (
                                          <span className="tt-batch-room" style={{ color: colors.text }}>
                                            {bs.room.room_no}
                                          </span>
                                        )}
                                      </div>
                                      <div className="tt-batch-subject">{bs.subject}</div>
                                      <div className="tt-batch-faculty">{bs.faculty}</div>
                                    </div>
                                  );
                                })}
                              </div>
                            </td>
                          );
                        }

                        // Regular single slot (theory or non-B.Pharm practical)
                        const slot = getSlot(day, time);

                        if (!slot) {
                          // Check if there's a recess-type slot
                          const anySlot = slots.find(s => s.day === day && `${s.start_time}–${s.end_time}` === time);
                          if (anySlot && (anySlot.is_recess || anySlot.class_type === 'recess')) {
                            return (
                              <td key={day} className="tt-recess-cell">
                                <div className="tt-recess-label">RECESS</div>
                              </td>
                            );
                          }
                          return <td key={day} className="tt-empty-cell" />;
                        }

                        if (slot.is_recess || slot.class_type === 'recess') {
                          return (
                            <td key={day} className="tt-recess-cell">
                              <div className="tt-recess-label">RECESS</div>
                            </td>
                          );
                        }

                        const hasRoom = !!slot.room_id;
                        const isPractical = slot.class_type === 'practical';

                        return (
                          <td key={day} style={{ padding: 0 }}>
                            <div className={`tt-slot ${hasRoom ? 'tt-slot-assigned' : 'tt-slot-unassigned'} ${isPractical ? 'tt-slot-practical' : 'tt-slot-theory'}`}>
                              <div className="tt-slot-subject">{slot.subject}</div>
                              <div className="tt-slot-faculty">{slot.faculty}</div>
                              {!isOriginal && (
                                slot.room ? (
                                  <div className="tt-slot-room">
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
                                    </svg>
                                    Room {slot.room.room_no}
                                  </div>
                                ) : (
                                  <div className="tt-slot-no-room">— No room</div>
                                )
                              )}
                              {slot.faculty_conflict && (
                                <div className="tt-faculty-conflict-badge" title={slot.faculty_conflict_detail}>
                                  ⚠️ Faculty clash
                                </div>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Print notice ── */}
        {!loading && slots.length > 0 && (
          <div style={{ marginTop: '16px', display: 'flex', gap: '12px', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <div style={{ fontSize: '12px', color: 'var(--slate)' }}>
              Showing {program} {program === 'Pharm D' ? `Year ${semester}` : `Semester ${semester}`} Division {division} — {slots.filter(s => !s.is_recess).length} slots
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => window.print()}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>
              </svg>
              Print
            </button>
          </div>
        )}
      </div>
    </>
  );
}

export default function TimetablePage() {
  return (
    <Suspense fallback={
      <div style={{ padding: '64px', textAlign: 'center' }}>
        <div className="pulse" style={{ color: 'var(--slate)', fontSize: '14px' }}>Loading timetable…</div>
      </div>
    }>
      <TimetableContent />
    </Suspense>
  );
}
