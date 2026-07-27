'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

export default function DashboardPage() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/stats');
      if (!res.ok) throw new Error('Failed to fetch stats');
      const data = await res.json();
      setStats(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const formatCategory = (cat) => cat.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  if (loading) {
    return (
      <>
        <div className="page-header">
          <div className="page-header-left">
            <h1>Dashboard</h1>
            <p>Overview of timetable assignments for the current semester</p>
          </div>
        </div>
        <div className="page-body">
          <div className="card" style={{ textAlign: 'center', padding: '48px' }}>
            <div className="pulse" style={{ marginBottom: '16px' }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--signal-blue)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>
              </svg>
            </div>
            <div className="headline-md">Loading dashboard data…</div>
          </div>
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <div className="page-header">
          <div className="page-header-left">
            <h1>Dashboard</h1>
            <p>Overview of timetable assignments for the current semester</p>
          </div>
        </div>
        <div className="page-body">
          <div className="alert alert-error" style={{ marginBottom: '16px' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <span>{error}</span>
          </div>
          <button className="btn btn-secondary" onClick={fetchStats}>Retry</button>
        </div>
      </>
    );
  }

  const { rooms, faculties, subjects, assignments, slots } = stats;

  return (
    <>
      <div className="page-header">
        <div className="page-header-left">
          <h1>Dashboard</h1>
          <p>Overview of timetable assignments for the current semester</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-ghost" onClick={fetchStats} title="Refresh data">
            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
            </svg>
          </button>
          <Link href="/upload" className="btn btn-primary">
            <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Upload timetable
          </Link>
        </div>
      </div>

      <div className="page-body">
        {/* ─── Top-Level Stats ─── */}
        <div className="stat-grid">
          <div className="stat-card">
            <div className="stat-card-label">Rooms loaded</div>
            <div className="stat-card-value">{rooms.total}</div>
            <div className="stat-card-footer">
              {rooms.classrooms} classrooms · {rooms.labs} labs
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-card-label">Faculty</div>
            <div className="stat-card-value">{faculties.total}</div>
            <div className="stat-card-footer">Active teaching staff (NF excluded)</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-label">Subjects</div>
            <div className="stat-card-value">{subjects.total}</div>
            <div className="stat-card-footer">
              {Object.entries(subjects.byProgram || {}).map(([prog, count], i) => (
                <span key={prog}>{i > 0 ? ' · ' : ''}{prog}: {count}</span>
              ))}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-card-label">NF Pending</div>
            <div className="stat-card-value" style={{ color: subjects.nfPending > 0 ? 'var(--conflict-red)' : 'var(--confirm-green)' }}>
              {subjects.nfPending}
            </div>
            <div className="stat-card-footer">Subjects without faculty assignment</div>
          </div>
        </div>

        {/* ─── Slot Assignment Progress ─── */}
        <div className="card" style={{ marginBottom: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div className="headline-md">Slot Assignment Progress</div>
            {slots.total > 0 && (
              <span className={`badge ${slots.assignedPercent === 100 ? 'badge-assigned' : slots.assignedPercent > 0 ? 'badge-partial' : 'badge-unassigned'}`}>
                {slots.assignedPercent}% complete
              </span>
            )}
          </div>

          {slots.total === 0 ? (
            <div className="empty-state" style={{ padding: '32px' }}>
              <div className="empty-state-icon">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
              </div>
              <div className="empty-state-title">No timetable slots uploaded yet</div>
              <p style={{ fontSize: '13px', color: 'var(--slate)', marginBottom: '16px' }}>Upload a timetable PDF to start the room assignment process.</p>
              <Link href="/upload" className="btn btn-primary btn-sm">Upload timetable</Link>
            </div>
          ) : (
            <>
              {/* Progress bar */}
              <div style={{
                height: '8px',
                background: 'var(--surface-container-high)',
                borderRadius: 'var(--radius-full)',
                overflow: 'hidden',
                marginBottom: '16px',
              }}>
                <div style={{
                  width: `${slots.assignedPercent}%`,
                  height: '100%',
                  background: slots.assignedPercent === 100 ? 'var(--confirm-green)' : 'var(--signal-blue)',
                  borderRadius: 'var(--radius-full)',
                  transition: 'width 0.5s ease',
                }} />
              </div>

              {/* Slot breakdown */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px' }}>
                <div style={{ padding: '12px 16px', background: 'var(--surface-container-low)', borderRadius: 'var(--radius-md)' }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--slate)', marginBottom: '4px' }}>Total Slots</div>
                  <div className="data-tabular" style={{ fontSize: '20px', fontWeight: 500 }}>{slots.total}</div>
                </div>
                <div style={{ padding: '12px 16px', background: 'rgba(30,158,107,0.06)', borderRadius: 'var(--radius-md)', borderLeft: '3px solid var(--confirm-green)' }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--confirm-green)', marginBottom: '4px' }}>Assigned</div>
                  <div className="data-tabular" style={{ fontSize: '20px', fontWeight: 500, color: 'var(--confirm-green)' }}>{slots.assigned}</div>
                </div>
                <div style={{ padding: '12px 16px', background: 'rgba(47,94,255,0.06)', borderRadius: 'var(--radius-md)', borderLeft: '3px solid var(--signal-blue)' }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--signal-blue)', marginBottom: '4px' }}>Manually Locked</div>
                  <div className="data-tabular" style={{ fontSize: '20px', fontWeight: 500, color: 'var(--signal-blue)' }}>{slots.manuallyLocked}</div>
                </div>
                <div style={{ padding: '12px 16px', background: slots.unassigned > 0 ? 'rgba(229,72,77,0.06)' : 'var(--surface-container-low)', borderRadius: 'var(--radius-md)', borderLeft: slots.unassigned > 0 ? '3px solid var(--conflict-red)' : '3px solid var(--outline-variant)' }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: slots.unassigned > 0 ? 'var(--conflict-red)' : 'var(--slate)', marginBottom: '4px' }}>Unassigned</div>
                  <div className="data-tabular" style={{ fontSize: '20px', fontWeight: 500, color: slots.unassigned > 0 ? 'var(--conflict-red)' : 'var(--ink)' }}>{slots.unassigned}</div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* ─── Quick Actions ─── */}
        <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' }}>
          <Link href="/generate" className="btn btn-primary">
            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
            Run Assignment
          </Link>
          <Link href="/timetable" className="btn btn-secondary">
            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            View Timetable
          </Link>
          <Link href="/assignment" className="btn btn-secondary">
            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            Manual Assignment
          </Link>
          <Link href="/rooms" className="btn btn-secondary">
            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
            Manage rooms
          </Link>
        </div>

        {/* ─── Room Inventory Summary ─── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
          {/* Room categories breakdown */}
          <div className="card">
            <div className="headline-md" style={{ marginBottom: '16px' }}>Room Inventory</div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th style={{ textAlign: 'right' }}>Count</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(rooms.byCategory || {})
                  .sort(([, a], [, b]) => b - a)
                  .map(([cat, count]) => (
                    <tr key={cat}>
                      <td>
                        <span className={`badge ${cat === 'classroom' ? 'badge-general' : 'badge-lab'}`}>
                          {formatCategory(cat)}
                        </span>
                      </td>
                      <td className="mono" style={{ textAlign: 'right' }}>{count}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          {/* Subject breakdown */}
          <div className="card">
            <div className="headline-md" style={{ marginBottom: '16px' }}>Subjects by Program</div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Program</th>
                  <th style={{ textAlign: 'right' }}>Subjects</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(subjects.byProgram || {})
                  .sort(([, a], [, b]) => b - a)
                  .map(([prog, count]) => (
                    <tr key={prog}>
                      <td style={{ fontWeight: 500 }}>{prog}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{count}</td>
                    </tr>
                  ))}
                <tr style={{ borderTop: '2px solid var(--outline-variant)' }}>
                  <td style={{ fontWeight: 600, fontSize: '13px' }}>Faculty Assignments</td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 600 }}>{assignments.total}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* ─── System Info Banner ─── */}
        <div className="alert alert-info">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
          </svg>
          <span>
            Data source: <strong>Book1.json</strong> (rooms) + <strong>Combined WL_Odd_26-27.json</strong> (faculty/subjects).
            NF entries are excluded — {subjects.nfPending} subject{subjects.nfPending !== 1 ? 's' : ''} pending manual faculty assignment.
          </span>
        </div>
      </div>
    </>
  );
}
