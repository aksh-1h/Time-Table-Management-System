'use client';
import { useState } from 'react';

const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const times = ['09:00–10:00', '10:00–11:00', '11:00–12:00', '12:00–13:00', '14:00–15:00', '15:00–16:00', '16:00–17:00'];

const sampleSlots = [
  { day: 'Monday', time: '09:00–10:00', subject: 'IMA', faculty: 'KTP', room: '201', state: 'assigned' },
  { day: 'Monday', time: '10:00–11:00', subject: 'PAT-II', faculty: 'SJP', room: '202', state: 'assigned' },
  { day: 'Monday', time: '11:00–12:00', subject: 'PP Lab', faculty: 'RKM', room: '401', state: 'locked' },
  { day: 'Monday', time: '14:00–15:00', subject: 'QAT', faculty: 'ANP', room: null, state: 'conflict' },
  { day: 'Tuesday', time: '09:00–10:00', subject: 'PAT-II', faculty: 'SJP', room: '201', state: 'assigned' },
  { day: 'Tuesday', time: '10:00–11:00', subject: 'IMA', faculty: 'KTP', room: '303', state: 'assigned' },
  { day: 'Tuesday', time: '11:00–12:00', subject: 'Inst Lab', faculty: 'DPV', room: '501', state: 'locked' },
  { day: 'Tuesday', time: '14:00–15:00', subject: 'HPE', faculty: 'MSP', room: '202', state: 'assigned' },
  { day: 'Wednesday', time: '09:00–10:00', subject: 'QAT', faculty: 'ANP', room: '201', state: 'assigned' },
  { day: 'Wednesday', time: '10:00–11:00', subject: 'HPE', faculty: 'MSP', room: null, state: 'unassigned' },
  { day: 'Wednesday', time: '11:00–12:00', subject: 'PP Lab', faculty: 'RKM', room: '401', state: 'locked' },
  { day: 'Thursday', time: '09:00–10:00', subject: 'IMA', faculty: 'KTP', room: '201', state: 'assigned' },
  { day: 'Thursday', time: '10:00–11:00', subject: 'PAT-II', faculty: 'SJP', room: null, state: 'conflict' },
  { day: 'Thursday', time: '14:00–15:00', subject: 'Inst Lab', faculty: 'DPV', room: '501', state: 'assigned' },
  { day: 'Friday', time: '09:00–10:00', subject: 'HPE', faculty: 'MSP', room: '303', state: 'assigned' },
  { day: 'Friday', time: '10:00–11:00', subject: 'QAT', faculty: 'ANP', room: '202', state: 'assigned' },
  { day: 'Friday', time: '14:00–15:00', subject: 'IMA', faculty: 'KTP', room: null, state: 'unassigned' },
];

export default function AssignmentPage() {
  const [viewMode, setViewMode] = useState('grid');
  const [slots, setSlots] = useState(sampleSlots);
  const [running, setRunning] = useState(false);

  const conflictCount = slots.filter(s => s.state === 'conflict').length;
  const unassignedCount = slots.filter(s => s.state === 'unassigned').length;

  const getSlot = (day, time) => slots.find(s => s.day === day && s.time === time);

  const handleRunAssignment = () => {
    setRunning(true);
    setTimeout(() => {
      setSlots(prev => prev.map(s =>
        s.state === 'unassigned' ? { ...s, room: '303', state: 'assigned' } : s
      ));
      setRunning(false);
    }, 2000);
  };

  return (
    <>
      <div className="page-header">
        <div className="page-header-left">
          <h1>Timetable & Assignment</h1>
          <p>Division A · Semester 7</p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <select className="filter-select"><option>Division A</option><option>Division B</option><option>Division C</option></select>
          <select className="filter-select"><option>Semester 7</option><option>Semester 5</option><option>Semester 3</option></select>
          <button className="btn btn-primary" onClick={handleRunAssignment} disabled={running}>
            {running ? (
              <span className="pulse">Running…</span>
            ) : (
              <>
                <svg viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                Run assignment
              </>
            )}
          </button>
        </div>
      </div>

      <div className="page-body">
        {/* Conflict banner */}
        {conflictCount > 0 && (
          <div className="alert alert-error">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <span><strong>{conflictCount} conflict{conflictCount > 1 ? 's' : ''}</strong> — slots with room booking collisions require manual resolution</span>
          </div>
        )}

        {/* Controls row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div className="status-legend">
            <div className="status-legend-item"><div className="status-legend-dot unassigned" /> Unassigned</div>
            <div className="status-legend-item"><div className="status-legend-dot assigned" /> Auto-assigned</div>
            <div className="status-legend-item"><div className="status-legend-dot locked" /> Manually locked</div>
            <div className="status-legend-item"><div className="status-legend-dot conflict" /> Conflict</div>
          </div>
          <div className="view-toggle">
            <button className={`view-toggle-btn ${viewMode === 'grid' ? 'active' : ''}`} onClick={() => setViewMode('grid')}>Grid</button>
            <button className={`view-toggle-btn ${viewMode === 'list' ? 'active' : ''}`} onClick={() => setViewMode('list')}>List</button>
          </div>
        </div>

        {/* Grid View */}
        {viewMode === 'grid' && (
          <div className="card" style={{ padding: 0, overflow: 'auto' }}>
            <table className="data-table" style={{ minWidth: '900px' }}>
              <thead>
                <tr>
                  <th style={{ width: '100px' }}>Time</th>
                  {days.map(d => <th key={d}>{d}</th>)}
                </tr>
              </thead>
              <tbody>
                {times.map(time => (
                  <tr key={time}>
                    <td className="mono" style={{ fontWeight: 500, whiteSpace: 'nowrap', fontSize: '13px' }}>{time}</td>
                    {days.map(day => {
                      const slot = getSlot(day, time);
                      if (!slot) return <td key={day} style={{ background: 'var(--surface-container-low)' }}></td>;
                      return (
                        <td key={day} style={{ padding: 0 }}>
                          <div className={`matrix-cell state-${slot.state}`} style={{ borderRadius: 0, minHeight: '64px' }}>
                            <div className="matrix-cell-subject">{slot.subject}</div>
                            <div className="matrix-cell-faculty">{slot.faculty}</div>
                            {slot.room ? (
                              <div className="matrix-cell-room">Room {slot.room}</div>
                            ) : (
                              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--conflict-red)', marginTop: '4px' }}>
                                {slot.state === 'conflict' ? '⚠ Conflict' : '—'}
                              </div>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* List View */}
        {viewMode === 'list' && (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Time</th>
                  <th>Subject</th>
                  <th>Faculty</th>
                  <th>Room</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {slots.map((s, i) => (
                  <tr key={i} style={s.state === 'conflict' ? { background: 'rgba(229,72,77,0.04)' } : {}}>
                    <td style={{ fontWeight: 500 }}>{s.day}</td>
                    <td className="mono">{s.time}</td>
                    <td style={{ fontWeight: 500 }}>{s.subject}</td>
                    <td className="mono">{s.faculty}</td>
                    <td className="mono">{s.room || '—'}</td>
                    <td>
                      <span className={`badge ${
                        s.state === 'assigned' ? 'badge-assigned' :
                        s.state === 'locked' ? 'badge-partial' :
                        s.state === 'conflict' ? 'badge-conflict' :
                        'badge-unassigned'
                      }`}>
                        {s.state === 'locked' ? 'Locked' : s.state.charAt(0).toUpperCase() + s.state.slice(1)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
