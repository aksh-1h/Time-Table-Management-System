'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';

const ALL_PROGRAMS = ['B.Pharm', 'M.Pharm', 'Pharm D'];

const PROGRAM_SEMESTERS = {
  'B.Pharm': [1, 2, 3, 4, 5, 6, 7, 8],
  'M.Pharm': [1, 2, 3, 4],
  'Pharm D': [1, 2, 3, 4, 5],
};

export default function GeneratePage() {
  // ── Scope Selection State ──
  const [selectedPrograms, setSelectedPrograms] = useState(['B.Pharm']);
  const [selectedSemesters, setSelectedSemesters] = useState([1, 2, 3, 4, 5, 6, 7, 8]);
  const [selectedYears, setSelectedYears] = useState([1, 2, 3, 4, 5]);

  // ── Generation State ──
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(null); // null | 'running' | 'done'
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  // Compute available semesters/years based on selected programs
  const availableSemesters = [...new Set(selectedPrograms.filter(p => p !== 'Pharm D').flatMap(p => PROGRAM_SEMESTERS[p] || []))].sort((a, b) => a - b);
  const availableYears = selectedPrograms.includes('Pharm D') ? PROGRAM_SEMESTERS['Pharm D'] : [];

  // ── Scope toggles ──
  const toggleProgram = (prog) => {
    setSelectedPrograms(prev =>
      prev.includes(prog) ? prev.filter(p => p !== prog) : [...prev, prog]
    );
  };

  const toggleSemester = (sem) => {
    setSelectedSemesters(prev =>
      prev.includes(sem) ? prev.filter(s => s !== sem) : [...prev, sem]
    );
  };

  const toggleYear = (year) => {
    setSelectedYears(prev =>
      prev.includes(year) ? prev.filter(y => y !== year) : [...prev, year]
    );
  };

  // ── Quick selects ──
  const selectAllSemesters = () => setSelectedSemesters([...availableSemesters]);
  const selectOddSemesters = () => setSelectedSemesters(availableSemesters.filter(s => s % 2 === 1));
  const selectEvenSemesters = () => setSelectedSemesters(availableSemesters.filter(s => s % 2 === 0));
  const selectAllYears = () => setSelectedYears([...availableYears]);
  const selectAllPrograms = () => setSelectedPrograms([...ALL_PROGRAMS]);

  // Count batches in scope (simplified estimation)
  const batchCount = selectedPrograms.reduce((sum, prog) => {
    if (prog === 'Pharm D') {
        return sum + selectedYears.length;
    }
    const sems = (PROGRAM_SEMESTERS[prog] || []).filter(s => selectedSemesters.includes(s));
    return sum + sems.length * 2; // Assuming ~2 divisions per semester on average
  }, 0);

  // ── Run Generation ──
  const handleGenerate = async () => {
    setGenerating(true);
    setProgress('running');
    setError(null);
    setResult(null);

    try {
      const res = await fetch('/api/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'full',
          scope: {
            programs: selectedPrograms,
            semesters: selectedSemesters,
            years: selectedYears,
          },
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Generation failed');
      }

      const data = await res.json();
      setResult(data);
      setProgress('done');
    } catch (err) {
      setError(err.message);
      setProgress(null);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <>
      <div className="page-header">
        <div className="page-header-left">
          <h1>Run Assignment</h1>
          <p>Select scope, then run full room assignment using pre-allocated room mapping</p>
        </div>
      </div>

      <div className="page-body">
        {/* ── Section A: Scope Selector ── */}
        <div className="card" style={{ marginBottom: '24px' }}>
          <div className="headline-md" style={{ marginBottom: '20px' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--signal-blue)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: '-4px', marginRight: '8px' }}>
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
            Select Scope
          </div>

          {/* Programs */}
          <div style={{ marginBottom: '20px' }}>
            <div className="scope-label">
              Programs
              <button className="scope-quick-btn" onClick={selectAllPrograms}>Select All</button>
            </div>
            <div className="scope-grid">
              {ALL_PROGRAMS.map(prog => (
                <label key={prog} className={`scope-chip ${selectedPrograms.includes(prog) ? 'active' : ''}`}>
                  <input
                    type="checkbox"
                    checked={selectedPrograms.includes(prog)}
                    onChange={() => toggleProgram(prog)}
                    style={{ display: 'none' }}
                  />
                  <span className="scope-chip-check">
                    {selectedPrograms.includes(prog) && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                    )}
                  </span>
                  {prog}
                </label>
              ))}
            </div>
          </div>

          {/* Semesters */}
          {availableSemesters.length > 0 && (
            <div style={{ marginBottom: '20px' }}>
              <div className="scope-label">
                Semesters
                <button className="scope-quick-btn" onClick={selectAllSemesters}>All</button>
                <button className="scope-quick-btn" onClick={selectOddSemesters}>Odd</button>
                <button className="scope-quick-btn" onClick={selectEvenSemesters}>Even</button>
              </div>
              <div className="scope-grid">
                {availableSemesters.map(sem => (
                  <label key={`sem-${sem}`} className={`scope-chip ${selectedSemesters.includes(sem) ? 'active' : ''}`}>
                    <input
                      type="checkbox"
                      checked={selectedSemesters.includes(sem)}
                      onChange={() => toggleSemester(sem)}
                      style={{ display: 'none' }}
                    />
                    <span className="scope-chip-check">
                      {selectedSemesters.includes(sem) && (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                      )}
                    </span>
                    Sem {sem}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Years (Pharm D) */}
          {availableYears.length > 0 && (
            <div style={{ marginBottom: '20px' }}>
              <div className="scope-label">
                Years (Pharm D)
                <button className="scope-quick-btn" onClick={selectAllYears}>All</button>
              </div>
              <div className="scope-grid">
                {availableYears.map(year => (
                  <label key={`year-${year}`} className={`scope-chip ${selectedYears.includes(year) ? 'active' : ''}`}>
                    <input
                      type="checkbox"
                      checked={selectedYears.includes(year)}
                      onChange={() => toggleYear(year)}
                      style={{ display: 'none' }}
                    />
                    <span className="scope-chip-check">
                      {selectedYears.includes(year) && (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                      )}
                    </span>
                    Year {year}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Scope summary */}
          <div className="scope-summary">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
            </svg>
            <span>
              <strong>{batchCount} batch{batchCount !== 1 ? 'es' : ''}</strong> selected
              {' '}({selectedPrograms.join(', ')})
            </span>
          </div>
        </div>

        {/* ── Generate Button ── */}
        <div className="card" style={{ marginBottom: '24px' }}>
          <div className="headline-md" style={{ marginBottom: '16px' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--signal-blue)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: '-4px', marginRight: '8px' }}>
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
            </svg>
            Run Generation
          </div>

          <p style={{ fontSize: '13px', color: 'var(--slate)', marginBottom: '16px' }}>
            Clears and recomputes room assignments for all selected batches at once. 
            This produces the most reliable, conflict-free result.
          </p>

          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <button
              className="btn btn-primary"
              onClick={handleGenerate}
              disabled={generating || batchCount === 0}
              style={{ padding: '12px 24px', fontSize: '15px' }}
            >
              {generating ? (
                <span className="pulse" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/>
                    <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/>
                    <line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/>
                    <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>
                  </svg>
                  Generating…
                </span>
              ) : (
                <>
                  <svg viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                  Run Assignment
                </>
              )}
            </button>
            {batchCount === 0 && (
              <span style={{ fontSize: '13px', color: 'var(--conflict-red)' }}>Select at least one program, semester, and division</span>
            )}
          </div>
        </div>

        {/* ── Error ── */}
        {error && (
          <div className="alert alert-error" style={{ marginBottom: '24px' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <span>{error}</span>
          </div>
        )}

        {/* ── Section C: Results ── */}
        {result && (
          <div style={{ animation: 'slideUp 0.3s ease' }}>
            {/* Results summary */}
            <div className={`alert ${result.stats.roomConflicts > 0 ? 'alert-error' : 'alert-success'}`} style={{ marginBottom: '24px' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
              <div>
                <strong>Generation Complete!</strong>
                {' '} — {result.stats.assigned} of {result.stats.totalSlots} slots assigned rooms.
                {result.stats.roomConflicts > 0 && ` 🚨 ${result.stats.roomConflicts} unresolved room shortages require department review.`}
                {result.stats.facultyConflicts > 0 && ` ⚠️ ${result.stats.facultyConflicts} faculty clashes flagged.`}
              </div>
            </div>

            {/* Stats cards */}
            <div className="stat-grid" style={{ marginBottom: '24px' }}>
              <div className="stat-card">
                <div className="stat-card-label">Total Slots</div>
                <div className="stat-card-value">{result.stats.totalSlots}</div>
                <div className="stat-card-footer">Across {result.stats.batchResults.length} batches</div>
              </div>
              <div className="stat-card">
                <div className="stat-card-label">Assigned Rooms</div>
                <div className="stat-card-value" style={{ color: 'var(--confirm-green)' }}>{result.stats.assigned}</div>
                <div className="stat-card-footer">
                  {result.stats.locked > 0 ? `${result.stats.locked} manually locked` : '100% fixed day/time'}
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-card-label">Room Shortages</div>
                <div className="stat-card-value" style={{ color: result.stats.roomConflicts > 0 ? 'var(--conflict-red)' : 'var(--confirm-green)' }}>
                  {result.stats.roomConflicts}
                </div>
                <div className="stat-card-footer">
                  {result.stats.roomConflicts > 0 ? 'Physical room shortage — department review needed' : 'All classes have rooms!'}
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-card-label">Faculty Conflicts</div>
                <div className="stat-card-value" style={{ color: result.stats.facultyConflicts > 0 ? '#d97706' : 'var(--confirm-green)' }}>
                  {result.stats.facultyConflicts}
                </div>
                <div className="stat-card-footer">
                  {result.stats.facultyConflicts > 0 ? 'Source timetable faculty double-bookings' : 'No faculty clashes!'}
                </div>
              </div>
            </div>

            {/* Batch results with View buttons */}
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--outline-variant)', background: 'var(--surface-container-low)' }}>
                <div className="headline-md">Batch Results</div>
                <div style={{ fontSize: '13px', color: 'var(--slate)', marginTop: '4px' }}>Click "View Timetable" to see the generated schedule for each batch</div>
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Program</th>
                    <th>Sem / Year</th>
                    <th>Division</th>
                    <th>Total</th>
                    <th>Assigned</th>
                    <th>Room Shortage</th>
                    <th>Faculty Clash</th>
                    <th>Status</th>
                    <th style={{ width: '140px' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {result.stats.batchResults.map((br, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 500 }}>{br.program}</td>
                      <td className="mono">{br.program === 'Pharm D' ? `Year ${br.semester}` : `Sem ${br.semester}`}</td>
                      <td>{br.division}</td>
                      <td className="mono">{br.total}</td>
                      <td className="mono" style={{ color: 'var(--confirm-green)' }}>{br.assigned}</td>
                      <td className="mono" style={{ color: br.roomConflicts > 0 ? 'var(--conflict-red)' : 'var(--slate)' }}>{br.roomConflicts}</td>
                      <td className="mono" style={{ color: br.facultyConflicts > 0 ? '#d97706' : 'var(--slate)' }}>{br.facultyConflicts}</td>
                      <td>
                        <span className={`badge ${br.roomConflicts === 0 ? 'badge-assigned' : br.assigned > 0 ? 'badge-partial' : 'badge-unassigned'}`}>
                          {br.roomConflicts === 0 ? 'Complete' : 'Shortage'}
                        </span>
                      </td>
                      <td>
                        <Link
                          href={`/timetable?program=${encodeURIComponent(br.program)}&semester=${br.semester}&division=${br.division}`}
                          className="btn btn-secondary btn-sm"
                          style={{ fontSize: '12px' }}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                          </svg>
                          View Timetable
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
