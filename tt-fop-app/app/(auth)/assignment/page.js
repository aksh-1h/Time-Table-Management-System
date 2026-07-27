'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Format time from '09:30:00' to '9:30'
 */
function formatTime(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':');
  return `${parseInt(h)}:${m}`;
}

/**
 * Format a time range: '9:30 - 10:25'
 */
function formatTimeRange(start, end) {
  return `${formatTime(start)} - ${formatTime(end)}`;
}

/**
 * Checks if two time ranges overlap.
 * Times are strings like '09:30:00'.
 */
function timesOverlap(s1, e1, s2, e2) {
  return s1 < e2 && s2 < e1;
}

// Recess window — no classes scheduled here
const RECESS_START = '12:30:00';
const RECESS_END   = '13:30:00';

export default function AssignmentPage() {
  const [slots, setSlots]   = useState([]);
  const [rooms, setRooms]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);
  const [viewMode, setViewMode] = useState('grid'); // grid-only

  // Filters
  const [filterProgram, setFilterProgram] = useState('');
  const [filterDivision, setFilterDivision] = useState('');
  const [filterSemester, setFilterSemester] = useState('');
  const [filterDay, setFilterDay]       = useState('');
  const [filterStatus, setFilterStatus]   = useState('');

  // Room picker modal
  const [editingSlot, setEditingSlot]   = useState(null);
  const [selectedRoom, setSelectedRoom]  = useState('');
  const [assignError, setAssignError]   = useState(null);
  const [assigning, setAssigning]       = useState(false);

  // ── Data Fetching ──
  const fetchSlots = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filterProgram) params.set('program', filterProgram);
      if (filterDivision) params.set('division', filterDivision);
      if (filterSemester) params.set('semester', filterSemester);
      if (filterDay)      params.set('day', filterDay);
      const res = await fetch(`/api/slots?${params}`);
      if (!res.ok) throw new Error('Failed to fetch slots');
      const data = await res.json();
      setSlots(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [filterProgram, filterDivision, filterSemester, filterDay]);

  const fetchRooms = useCallback(async () => {
    try {
      const res = await fetch('/api/rooms');
      if (!res.ok) throw new Error('Failed to fetch rooms');
      const data = await res.json();
      setRooms(data);
    } catch (err) {
      console.error('Error loading rooms:', err);
    }
  }, []);

  useEffect(() => {
    fetchSlots();
    fetchRooms();
  }, [fetchSlots, fetchRooms]);

  const [programs, setPrograms] = useState([]);
  const [divisions, setDivisions] = useState([]);
  const [semesters, setSemesters] = useState([]);

  useEffect(() => {
    fetch('/api/slots/options')
      .then(res => res.json())
      .then(data => {
        if (data.programs) setPrograms(data.programs);
        if (data.divisions) setDivisions(data.divisions);
        if (data.semesters) setSemesters(data.semesters);
        
        setFilterProgram(prev => prev || (data.programs?.[0] || ''));
        setFilterDivision(prev => prev || (data.divisions?.[0] || ''));
        setFilterSemester(prev => prev || String(data.semesters?.[0] || ''));
      })
      .catch(err => console.error("Error loading filter options:", err));
  }, []);

  const timeSlots = useMemo(() => {
    const times = new Set();
    for (const s of slots) times.add(`${s.start_time}–${s.end_time}`);
    return [...times].sort();
  }, [slots]);

  const filteredSlots = useMemo(() => {
    return slots.filter(s => {
      if (s.is_recess || s.class_type === 'recess') return true; // always show recess
      if (filterStatus === 'assigned'   && !s.room_id)           return false;
      if (filterStatus === 'unassigned' && s.room_id)            return false;
      if (filterStatus === 'locked'     && !s.manually_assigned) return false;
      return true;
    });
  }, [slots, filterStatus]);

  const getSlotState = (slot) => {
    if (slot.is_recess || slot.class_type === 'recess') return 'recess';
    if (slot.manually_assigned && slot.room_id) return 'locked';
    if (slot.room_id) return 'assigned';
    return 'unassigned';
  };

  const getSlot = (day, time) =>
    filteredSlots.find(s => s.day === day && `${s.start_time}–${s.end_time}` === time);

  const counts = useMemo(() => {
    const nonRecess = filteredSlots.filter(s => !s.is_recess && s.class_type !== 'recess' && s.class_type !== 'self_study');
    const assigned   = nonRecess.filter(s => s.room_id).length;
    const unassigned = nonRecess.filter(s => !s.room_id).length;
    const locked     = nonRecess.filter(s => s.manually_assigned && s.room_id).length;
    const facultyConflicts = filteredSlots.filter(s => s.faculty_conflict).length;
    return { assigned, unassigned, locked, facultyConflicts, total: nonRecess.length };
  }, [filteredSlots]);

  // ── Room helpers ──
  const isInRecess = (start, end) =>
    start < RECESS_END && end > RECESS_START;

  const classrooms = useMemo(() => rooms.filter(r => r.category === 'classroom'), [rooms]);
  const labRooms   = useMemo(() => rooms.filter(r => r.category !== 'classroom'), [rooms]);

  /**
   * Room clash: check if a room is already used at the same day+time.
   */
  const isRoomFreeInState = useCallback((day, start, end, roomId, excludeSlotId) => {
    return !slots.some(
      s =>
        s.id !== excludeSlotId &&
        s.room_id === roomId &&
        s.day === day &&
        timesOverlap(start, end, s.start_time, s.end_time)
    );
  }, [slots]);

  // ── Manual Room Assignment ──
  const handleOpenRoomPicker = (slot) => {
    setEditingSlot(slot);
    setSelectedRoom(slot.room_id || '');
    setAssignError(null);
  };

  const handleAssignRoom = async () => {
    if (!editingSlot) return;
    setAssigning(true);
    setAssignError(null);

    // Check recess conflict
    if (selectedRoom && isInRecess(editingSlot.start_time, editingSlot.end_time)) {
      setAssignError('This time slot falls within the recess break (12:30–13:30). Cannot assign a room.');
      setAssigning(false);
      return;
    }

    if (selectedRoom) {
      // ── Room clash check ──
      if (!isRoomFreeInState(editingSlot.day, editingSlot.start_time, editingSlot.end_time, selectedRoom, editingSlot.id)) {
        const conflict = slots.find(
          s => s.id !== editingSlot.id &&
               s.room_id === selectedRoom &&
               s.day === editingSlot.day &&
               timesOverlap(editingSlot.start_time, editingSlot.end_time, s.start_time, s.end_time)
        );
        setAssignError(
          `⚠ Room conflict: Room ${rooms.find(r=>r.id===selectedRoom)?.room_no} is already assigned to` +
          ` ${conflict?.subject || 'another class'} (${conflict?.division || ''} · ${conflict?.start_time}–${conflict?.end_time}) on ${editingSlot.day}.`
        );
        setAssigning(false);
        return;
      }
    }

    const roomObj = selectedRoom ? rooms.find(r => r.id === selectedRoom) || null : null;

    try {
      const res = await fetch('/api/slots', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingSlot.id,
          room_id: selectedRoom || null,
          room: roomObj,
          manually_assigned: !!selectedRoom,
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        if (errData.conflicts) {
          setAssignError(
            `Room conflict with: ${errData.conflicts.map(c => `${c.subject} (${c.division} ${c.time})`).join(', ')}`
          );
        } else {
          setAssignError(errData.error || 'Failed to assign room');
        }
        return;
      }

      // Optimistic update — patch local state immediately
      setSlots(prev =>
        prev.map(s =>
          s.id === editingSlot.id
            ? { ...s, room_id: selectedRoom || null, room: roomObj, manually_assigned: !!selectedRoom }
            : s
        )
      );
      setEditingSlot(null);
    } catch (err) {
      setAssignError(err.message);
    } finally {
      setAssigning(false);
    }
  };


  // Auto-assignment is now handled by the Generate Timetable page (/generate)
  // This page is for manual room adjustments only.

  // ── Render ──
  if (loading && slots.length === 0) {
    return (
      <>
        <div className="page-header">
          <div className="page-header-left">
            <h1>Timetable &amp; Assignment</h1>
            <p>Loading slot data…</p>
          </div>
        </div>
        <div className="page-body">
          <div className="card" style={{ textAlign: 'center', padding: '48px' }}>
            <div className="pulse" style={{ marginBottom: '16px' }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--signal-blue)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/>
                <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/>
                <line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/>
                <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>
              </svg>
            </div>
            <div className="headline-md">Loading timetable data…</div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <div className="page-header-left">
          <h1>Manual Assignment</h1>
          <p>
            Click any cell to manually assign or change rooms.{' '}
            {filteredSlots.length} slot{filteredSlots.length !== 1 ? 's' : ''}
            {filterDivision ? ` · Div ${filterDivision}` : ''}
            {filterSemester ? ` · Sem ${filterSemester}` : ''}
            {' '}· 9:30 – 4:25 (Recess 12:30 – 1:30)
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <select className="filter-select" value={filterProgram} onChange={e => { setFilterProgram(e.target.value); setFilterSemester('1'); setFilterDivision('A'); }}>
            {programs.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <select className="filter-select" value={filterSemester} onChange={e => setFilterSemester(e.target.value)}>
            {(
              filterProgram === 'M.Pharm' ? [1, 2, 3, 4] :
              filterProgram === 'Pharm D' ? [1, 2, 3, 4, 5] :
              (semesters.length > 0 ? semesters : [1, 2, 3, 4, 5, 6, 7, 8])
            ).map(s => (
              <option key={s} value={s}>{filterProgram === 'Pharm D' ? `Year ${s}` : `Semester ${s}`}</option>
            ))}
          </select>
          <select className="filter-select" value={filterDivision} onChange={e => setFilterDivision(e.target.value)}>
            {divisions.map(d => <option key={d} value={d}>Division {d}</option>)}
          </select>
          <select className="filter-select" value={filterDay} onChange={e => setFilterDay(e.target.value)}>
            <option value="">All Days</option>
            {DAYS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <a href="/generate" className="btn btn-primary">
            <svg viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
            Run Assignment
          </a>
        </div>
      </div>

      <div className="page-body">
        {error && (
          <div className="alert alert-error" style={{ marginBottom: '16px' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <span>{error}</span>
          </div>
        )}

        {counts.unassigned > 0 && (
          <div className="alert alert-error" style={{ marginBottom: '16px' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <span>
              <strong>{counts.unassigned} unassigned slot{counts.unassigned > 1 ? 's' : ''}</strong>
              {' '}— click <strong>Run Assignment</strong> to auto-assign, or click a slot to assign manually.
            </span>
          </div>
        )}

        {/* Controls row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div className="status-legend" style={{ gap: '16px' }}>
            <div className="status-legend-item"><div className="status-legend-dot unassigned" /> Room Shortage ({counts.unassigned})</div>
            <div className="status-legend-item"><div className="status-legend-dot assigned" /> Auto-assigned ({counts.assigned - counts.locked})</div>
            <div className="status-legend-item"><div className="status-legend-dot locked" /> Manually locked ({counts.locked})</div>
            {counts.facultyConflicts > 0 && (
              <div className="status-legend-item" style={{ color: '#d97706', fontWeight: 600 }}>
                ⚠️ Faculty Clash ({counts.facultyConflicts})
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <select className="filter-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              <option value="">All statuses</option>
              <option value="assigned">Assigned</option>
              <option value="unassigned">Unassigned (Shortage)</option>
              <option value="locked">Manually Locked</option>
            </select>
          </div>
        </div>

        {filteredSlots.length === 0 ? (
          <div className="card">
            <div className="empty-state">
              <div className="empty-state-icon">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
              </div>
              <div className="empty-state-title">No slots found</div>
              <p style={{ fontSize: '13px', color: 'var(--slate)' }}>
                {slots.length === 0
                  ? 'Upload a timetable PDF first to populate slot data.'
                  : 'No slots match the current filters. Try adjusting the filters above.'}
              </p>
            </div>
          </div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: 'auto' }}>
                <table className="data-table" style={{ minWidth: '900px' }}>
                  <thead>
                    <tr>
                      <th style={{ width: '140px' }}>Time</th>
                      {DAYS.filter(d => filteredSlots.some(s => s.day === d)).map(d => <th key={d}>{d}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {timeSlots.map(time => {
                      const [startT, endT] = time.split('–');
                      const isRecess = startT === '12:30:00';
                      return (
                        <tr key={time} style={isRecess ? { background: 'var(--surface-container-low)' } : {}}>
                          <td className="mono" style={{ fontWeight: 500, whiteSpace: 'nowrap', fontSize: '12px' }}>{formatTimeRange(startT, endT)}</td>
                          {DAYS.filter(d => filteredSlots.some(s => s.day === d)).map(day => {
                            const slot = getSlot(day, time);
                            if (isRecess || (slot && (slot.is_recess || slot.class_type === 'recess'))) {
                              return (
                                <td key={day} style={{ padding: 0 }}>
                                  <div style={{
                                    minHeight: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    background: 'var(--surface-container-low)', color: 'var(--slate)',
                                    fontWeight: 600, fontSize: '12px', letterSpacing: '0.05em', textTransform: 'uppercase',
                                  }}>
                                    RECESS
                                  </div>
                                </td>
                              );
                            }
                            if (!slot) return <td key={day} style={{ background: 'var(--surface-container-low)' }} />;
                            const state = getSlotState(slot);
                            return (
                              <td key={day} style={{ padding: 0 }}>
                                <div
                                  className={`matrix-cell state-${state}`}
                                  style={{ borderRadius: 0, minHeight: '64px', cursor: 'pointer', position: 'relative' }}
                                  onClick={() => handleOpenRoomPicker(slot)}
                                  title={`Click to ${slot.room_id ? 'change' : 'assign'} room`}
                                >
                                  <div className="matrix-cell-subject">{slot.subject}</div>
                                  <div className="matrix-cell-faculty">{slot.faculty}</div>
                                  {slot.faculty_conflict && (
                                    <div style={{ fontSize: '10px', color: '#b45309', background: '#fef3c7', padding: '1px 4px', borderRadius: '4px', marginTop: '2px', display: 'inline-block' }} title={slot.faculty_conflict_detail || 'Faculty double-booked'}>
                                      ⚠️ Faculty Clash
                                    </div>
                                  )}
                                  {slot.room ? (
                                    <div className="matrix-cell-room">
                                      {state === 'locked' ? '🔒 ' : ''}Room {slot.room.room_no}
                                    </div>
                                  ) : slot.class_type !== 'self_study' ? (
                                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--conflict-red)', marginTop: '4px', fontWeight: 600 }} title={slot.room_conflict_detail || 'Room shortage'}>
                                      🚨 Room Shortage
                                    </div>
                                  ) : null}
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
      </div>

      {/* ─── Room Picker Modal ─── */}
      {editingSlot && (
        <div className="modal-overlay" onClick={() => setEditingSlot(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '520px' }}>
            <div className="modal-header">
              <h2>Assign Room</h2>
              <button className="btn btn-ghost" onClick={() => setEditingSlot(null)}>
                <svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            {/* Slot info */}
            <div style={{ padding: '12px 16px', background: 'var(--surface-container-low)', borderRadius: 'var(--radius-md)', marginBottom: '16px', fontSize: '13px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div><span style={{ color: 'var(--slate)' }}>Subject:</span> <strong>{editingSlot.subject}</strong></div>
                <div><span style={{ color: 'var(--slate)' }}>Faculty:</span> <strong>{editingSlot.faculty}</strong></div>
                <div><span style={{ color: 'var(--slate)' }}>Day:</span> <strong>{editingSlot.day}</strong></div>
                <div><span style={{ color: 'var(--slate)' }}>Time:</span> <strong className="mono">{formatTimeRange(editingSlot.start_time, editingSlot.end_time)}</strong></div>
                <div><span style={{ color: 'var(--slate)' }}>Division:</span> <strong>{editingSlot.division}</strong></div>
                <div><span style={{ color: 'var(--slate)' }}>Batch:</span> <strong>{editingSlot.batch}</strong></div>
              </div>
              {editingSlot.faculty_conflict && (
                <div style={{ marginTop: '8px', padding: '6px 10px', background: '#fef3c7', color: '#b45309', borderRadius: '4px', fontSize: '12px' }}>
                  ⚠️ <strong>Faculty Conflict:</strong> {editingSlot.faculty_conflict_detail || 'Faculty is scheduled for another class at this time in source timetable.'} Room allocation is still permitted.
                </div>
              )}
              {editingSlot.room && (
                <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid var(--outline-variant)' }}>
                  <span style={{ color: 'var(--slate)' }}>Current room:</span>{' '}
                  <strong className="mono" style={{ color: 'var(--signal-blue)' }}>{editingSlot.room.room_no}</strong>
                  <span style={{ color: 'var(--slate)', marginLeft: '8px' }}>({editingSlot.room.room_name})</span>
                </div>
              )}
            </div>

            {/* Room selector */}
            <div className="form-group">
              <label className="form-label" htmlFor="room-picker">Select Room</label>
              <select
                id="room-picker"
                className="form-select"
                value={selectedRoom}
                onChange={e => setSelectedRoom(e.target.value)}
              >
                <option value="">— No room (unassign) —</option>
                {rooms.map(r => (
                  <option key={r.id} value={r.id}>
                    {r.room_no} — {r.room_name} ({r.category.replace(/_/g, ' ')}) [{r.capacity}]
                  </option>
                ))}
              </select>
            </div>

            {assignError && (
              <div className="alert alert-error" style={{ fontSize: '13px' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                <span>{assignError}</span>
              </div>
            )}

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setEditingSlot(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleAssignRoom} disabled={assigning}>
                {assigning ? 'Assigning…' : 'Assign Room'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
