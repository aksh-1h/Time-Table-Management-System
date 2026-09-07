'use client';
import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';

// ── Period time labels ──
const PERIOD_TIMES = [
  { period: 0, label: '09:30 – 10:30', start: '09:30:00', end: '10:30:00' },
  { period: 1, label: '10:30 – 11:30', start: '10:30:00', end: '11:30:00' },
  { period: 2, label: '11:30 – 12:30', start: '11:30:00', end: '12:30:00' },
  { period: 3, label: '13:30 – 14:30', start: '13:30:00', end: '14:30:00' },
  { period: 4, label: '14:30 – 15:30', start: '14:30:00', end: '15:30:00' },
  { period: 5, label: '15:30 – 16:25', start: '15:30:00', end: '16:25:00' },
];

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const CLASS_TYPES = ['theory', 'practical', 'self_study'];

// Build complete list of all expected university pharmacy timetable batches
function buildAllBatches() {
  const batches = [];

  // 1. B.Pharm: Semesters 1, 3, 5, 7 × Division A, Division B
  const bpharmSemesters = [1, 3, 5, 7];
  const bpharmDivisions = ['A', 'B'];
  for (const sem of bpharmSemesters) {
    for (const div of bpharmDivisions) {
      batches.push({
        id: `B.Pharm-sem${sem}-div${div}`,
        program: 'B.Pharm',
        semester: sem,
        division: div,
        label: `B.Pharm — Semester ${sem} (Division ${div})`,
        category: 'B.Pharm'
      });
    }
  }

  // 2. M.Pharm: Semesters 1, 3 × Specializations
  const mpharmSemesters = [1, 3];
  const mpharmSpecs = [
    'Pharmaceutics', 'Pharmachemistry', 'Pharmacology',
    'QA', 'Techno', 'PA', 'RA', 'PP', 'Phyto'
  ];
  for (const sem of mpharmSemesters) {
    for (const spec of mpharmSpecs) {
      batches.push({
        id: `M.Pharm-sem${sem}-${spec}`,
        program: 'M.Pharm',
        semester: sem,
        division: spec,
        label: `M.Pharm — Semester ${sem} (${spec})`,
        category: 'M.Pharm'
      });
    }
  }

  // 3. Pharm D: Years 1–5 (Annual system, no divisions — stored as null in DB)
  for (let year = 1; year <= 5; year++) {
    batches.push({
      id: `PharmD-year${year}`,
      program: 'Pharm D',
      semester: year,
      division: null,
      label: `Pharm D — Year ${year}`,
      category: 'Pharm D'
    });
  }

  return batches;
}

const ALL_BATCHES = buildAllBatches();

// ── Score badge helper ──
function ScoreBadge({ score, size = 'normal' }) {
  const color = score >= 80 ? 'var(--confirm-green)' : score >= 50 ? '#e8a317' : 'var(--conflict-red)';
  const bg = score >= 80 ? 'rgba(30,158,107,0.1)' : score >= 50 ? 'rgba(232,163,23,0.1)' : 'rgba(224,49,49,0.1)';
  const fontSize = size === 'large' ? '22px' : size === 'small' ? '11px' : '13px';
  const padding = size === 'large' ? '8px 16px' : size === 'small' ? '2px 6px' : '3px 8px';

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      background: bg, color, fontWeight: 700, fontSize,
      borderRadius: 'var(--radius)', padding,
      border: `1px solid ${color}20`,
    }}>
      {Math.round(score)}%
    </span>
  );
}

// ── Score dot for per-entry indicator ──
function ScoreDot({ score }) {
  const color = score >= 80 ? 'var(--confirm-green)' : score >= 50 ? '#e8a317' : 'var(--conflict-red)';
  return (
    <div style={{
      width: '8px', height: '8px', borderRadius: '50%',
      background: color, flexShrink: 0,
    }} title={`Score: ${score}%`} />
  );
}

// ── Inline editable cell ──
function EditableCell({ value, onChange, type = 'text', options = null, style = {} }) {
  if (options) {
    return (
      <select
        className="form-select"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        style={{ fontSize: '12px', padding: '4px 8px', minWidth: '80px', ...style }}
      >
        {options.map(opt => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    );
  }

  return (
    <input
      type={type}
      className="form-input"
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      style={{ fontSize: '12px', padding: '4px 8px', minWidth: '60px', ...style }}
    />
  );
}


export default function UploadPage() {
  const [file, setFile] = useState(null);
  const [selectedBatchId, setSelectedBatchId] = useState('');
  
  const [stage, setStage] = useState('idle'); // idle | processing | review | success | error
  const [message, setMessage] = useState('');
  const [storedSchedules, setStoredSchedules] = useState([]);
  const [categoryFilter, setCategoryFilter] = useState('all');

  // ── Review state ──
  const [reviewUploadId, setReviewUploadId] = useState(null);
  const [reviewEntries, setReviewEntries] = useState([]);
  const [overallScore, setOverallScore] = useState(0);
  const [editedEntries, setEditedEntries] = useState({}); // { entryIndex: { field: newValue } }
  const [savingReview, setSavingReview] = useState(false);
  const [reviewMessage, setReviewMessage] = useState('');
  const [reviewBatchLabel, setReviewBatchLabel] = useState('');

  const fetchScheduleList = async () => {
    try {
      const res = await fetch('/api/schedules/list');
      const data = await res.json();
      if (data.schedules) {
        setStoredSchedules(data.schedules);
      }
    } catch (e) {
      console.error('Failed to load schedule list from Supabase:', e);
    }
  };

  useEffect(() => {
    fetchScheduleList();
  }, []);

  // Map uploaded schedules to batch IDs
  const uploadedBatchMap = useMemo(() => {
    const map = new Map();
    for (const sched of storedSchedules) {
      if (sched.status === 'failed') continue;
      let key = '';
      if (sched.program === 'B.Pharm') {
        key = `B.Pharm-sem${sched.semester}-div${sched.division || 'A'}`;
      } else if (sched.program === 'M.Pharm') {
        key = `M.Pharm-sem${sched.semester}-${sched.division}`;
      } else if (sched.program === 'Pharm D') {
        key = `PharmD-year${sched.semester}`;
      } else {
        key = `${sched.program}-sem${sched.semester}-div${sched.division || 'A'}`;
      }
      map.set(key, sched);
    }
    return map;
  }, [storedSchedules]);

  // Determine remaining pending batches for the "Mark as Uploaded" dropdown
  const pendingBatches = useMemo(() => {
    return ALL_BATCHES.filter(batch => !uploadedBatchMap.has(batch.id));
  }, [uploadedBatchMap]);

  // Set default selected batch when pending list changes
  useEffect(() => {
    if (pendingBatches.length > 0 && (!selectedBatchId || !pendingBatches.some(b => b.id === selectedBatchId))) {
      setSelectedBatchId(pendingBatches[0].id);
    }
  }, [pendingBatches, selectedBatchId]);

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
    }
  };

  const handleUploadAndMark = async (e) => {
    e.preventDefault();
    if (!file) {
      setStage('error');
      setMessage('Please select a PDF or DOCX file to upload.');
      return;
    }

    const batch = ALL_BATCHES.find(b => b.id === selectedBatchId);
    if (!batch) {
      setStage('error');
      setMessage('Please select a target timetable batch to mark as uploaded.');
      return;
    }

    setStage('processing');
    setMessage('Uploading file to Supabase Storage & parsing timetable slots...');

    const formData = new FormData();
    formData.append('file', file);
    formData.append('program', batch.program);
    formData.append('semester', batch.semester);
    formData.append('division', batch.division === 'ALL' ? '' : batch.division);

    try {
      const res = await fetch('/api/schedules/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');

      // ── Enter review mode ──
      setReviewUploadId(data.id);
      setOverallScore(data.overallParsingScore || 0);
      setReviewBatchLabel(batch.label);
      setReviewMessage(data.message || '');

      // If entries are included in the response and have IDs, use them directly
      if (data.entries && data.entries.length > 0 && data.entries[0]?.id) {
        setReviewEntries(data.entries);
      } else {
        // Fetch from API to ensure we have DB IDs
        await fetchReviewEntries(data.id);
      }

      setEditedEntries({});
      setStage('review');
      setFile(null);
      
      const fileInput = document.getElementById('file-upload');
      if (fileInput) fileInput.value = '';

      fetchScheduleList();
    } catch (err) {
      setStage('error');
      setMessage(err.message);
    }
  };

  const fetchReviewEntries = async (uploadId) => {
    try {
      const res = await fetch(`/api/schedules/entries?upload_id=${uploadId}`);
      const data = await res.json();
      if (data.entries) {
        setReviewEntries(data.entries);
      }
    } catch (e) {
      console.error('Failed to load review entries:', e);
    }
  };

  // ── Handle existing upload review ──
  const handleReviewExisting = async (uploadId, batchLabel) => {
    setReviewUploadId(uploadId);
    setReviewBatchLabel(batchLabel);
    setEditedEntries({});
    setReviewMessage('');

    try {
      const res = await fetch(`/api/schedules/entries?upload_id=${uploadId}`);
      const data = await res.json();
      if (data.entries) {
        setReviewEntries(data.entries);
        // Calculate overall score from entries
        const scores = data.entries.map(e => e.parsing_score || 0);
        const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
        setOverallScore(Math.round(avg * 10) / 10);
      }
    } catch (e) {
      console.error('Failed to load review entries:', e);
    }

    setStage('review');
  };

  // ── Update an entry field in local state ──
  const updateEntryField = useCallback((index, field, value) => {
    setEditedEntries(prev => ({
      ...prev,
      [index]: {
        ...(prev[index] || {}),
        [field]: value,
      }
    }));
  }, []);

  // ── Get the current value of an entry field (edited or original) ──
  const getEntryValue = useCallback((index, field) => {
    if (editedEntries[index] && field in editedEntries[index]) {
      return editedEntries[index][field];
    }
    return reviewEntries[index]?.[field];
  }, [editedEntries, reviewEntries]);

  // ── Save all edits ──
  const handleSaveChanges = async () => {
    const editedIndices = Object.keys(editedEntries);
    if (editedIndices.length === 0) {
      setReviewMessage('No changes to save.');
      return;
    }

    setSavingReview(true);
    setReviewMessage('Saving changes...');

    try {
      let savedCount = 0;
      for (const idx of editedIndices) {
        const entry = reviewEntries[idx];
        if (!entry || !entry.id) continue;

        const updates = editedEntries[idx];
        const res = await fetch('/api/schedules/entries', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: entry.id, ...updates }),
        });

        if (res.ok) {
          savedCount++;
        } else {
          const errData = await res.json();
          console.error(`Failed to update entry ${entry.id}:`, errData.error);
        }
      }

      setReviewMessage(`✓ Saved ${savedCount} change(s) successfully.`);
      setEditedEntries({});

      // Refresh entries from DB
      await fetchReviewEntries(reviewUploadId);
    } catch (err) {
      setReviewMessage(`Error saving changes: ${err.message}`);
    } finally {
      setSavingReview(false);
    }
  };

  // ── Delete a single entry ──
  const handleDeleteEntry = async (index) => {
    const entry = reviewEntries[index];
    if (!entry) return;

    const subjectLabel = entry.subject ? `"${entry.subject}"` : 'this slot';
    const dayLabel = entry.day ? ` on ${entry.day}` : '';
    const periodLabel = entry.period !== undefined ? ` (Period ${entry.period})` : '';
    
    if (!window.confirm(`Delete slot: ${subjectLabel}${dayLabel}${periodLabel}?`)) return;

    try {
      if (entry.id) {
        const res = await fetch(`/api/schedules/entries?id=${encodeURIComponent(entry.id)}`, { method: 'DELETE' });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || 'Failed to delete slot from database');
        }
      }

      const updated = [...reviewEntries];
      updated.splice(index, 1);
      setReviewEntries(updated);

      // Clean up editedEntries indices
      setEditedEntries(prev => {
        const next = {};
        Object.keys(prev).forEach(k => {
          const idxNum = parseInt(k, 10);
          if (idxNum < index) {
            next[idxNum] = prev[idxNum];
          } else if (idxNum > index) {
            next[idxNum - 1] = prev[idxNum];
          }
        });
        return next;
      });

      // Recalculate overall score
      const scores = updated.map(e => e.parsing_score || 0);
      const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
      setOverallScore(Math.round(avg * 10) / 10);
      setReviewMessage('Slot deleted successfully.');

      // Refresh schedule list in background
      fetchScheduleList();
    } catch (err) {
      console.error('Delete slot error:', err);
      alert(`Error deleting slot: ${err.message}`);
    }
  };

  const handleDelete = async (id, label) => {
    if (!confirm(`Are you sure you want to delete the uploaded timetable for "${label}"? This will remove the file from Supabase storage.`)) return;
    try {
      const res = await fetch(`/api/schedules?id=${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete schedule');
      fetchScheduleList();
    } catch (err) {
      alert(err.message);
    }
  };

  const resetFlow = () => {
    setStage('idle');
    setFile(null);
    setMessage('');
    setReviewUploadId(null);
    setReviewEntries([]);
    setEditedEntries({});
    setOverallScore(0);
    setReviewMessage('');
    setReviewBatchLabel('');
  };

  const totalBatches = ALL_BATCHES.length;
  const uploadedCount = uploadedBatchMap.size;
  const progressPercent = Math.round((uploadedCount / totalBatches) * 100);

  const filteredBatches = useMemo(() => {
    if (categoryFilter === 'all') return ALL_BATCHES;
    return ALL_BATCHES.filter(b => b.category === categoryFilter);
  }, [categoryFilter]);

  const hasEdits = Object.keys(editedEntries).length > 0;

  // ── Score distribution for review ──
  const scoreDistribution = useMemo(() => {
    if (!reviewEntries.length) return { good: 0, medium: 0, poor: 0 };
    const good = reviewEntries.filter(e => (e.parsing_score || 0) >= 80).length;
    const medium = reviewEntries.filter(e => (e.parsing_score || 0) >= 50 && (e.parsing_score || 0) < 80).length;
    const poor = reviewEntries.filter(e => (e.parsing_score || 0) < 50).length;
    return { good, medium, poor };
  }, [reviewEntries]);

  return (
    <div className="page-body">
      <div className="page-header" style={{ marginBottom: '32px' }}>
        <div>
          <h1 className="page-title">Upload Timetables</h1>
          <p className="page-subtitle">Upload timetable files to Supabase and mark them for each course & division.</p>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════
          REVIEW MODE — shown after successful upload
          ══════════════════════════════════════════════════════════ */}
      {stage === 'review' && (
        <div className="tt-card" style={{ margin: '0 auto 36px auto' }}>
          <div className="tt-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <h2 className="tt-card-title" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--signal-blue)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
                  <polyline points="10 9 9 9 8 9" />
                </svg>
                Parsing Review — {reviewBatchLabel}
              </h2>
              {reviewMessage && (
                <div style={{ fontSize: '13px', color: 'var(--confirm-green)', marginTop: '4px', fontWeight: 500 }}>
                  {reviewMessage}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button className="btn btn-secondary btn-sm" onClick={resetFlow}>
                ← Back to Upload
              </button>
            </div>
          </div>

          <div className="tt-card-body">
            {/* ── Score Overview Panel ── */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: '16px',
              marginBottom: '24px',
            }}>
              {/* Overall Score */}
              <div style={{
                padding: '20px',
                background: overallScore >= 80 ? 'rgba(30,158,107,0.06)' : overallScore >= 50 ? 'rgba(232,163,23,0.06)' : 'rgba(224,49,49,0.06)',
                borderRadius: 'var(--radius-lg)',
                border: `1px solid ${overallScore >= 80 ? 'rgba(30,158,107,0.15)' : overallScore >= 50 ? 'rgba(232,163,23,0.15)' : 'rgba(224,49,49,0.15)'}`,
                textAlign: 'center',
              }}>
                <div style={{ fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--slate)', marginBottom: '8px' }}>
                  Overall Score
                </div>
                <ScoreBadge score={overallScore} size="large" />
                <div style={{ fontSize: '11px', color: 'var(--slate)', marginTop: '6px' }}>
                  {overallScore >= 80 ? 'Good quality' : overallScore >= 50 ? 'Needs review' : 'Poor — manual edits needed'}
                </div>
              </div>

              {/* Total Entries */}
              <div style={{
                padding: '20px',
                background: 'var(--surface-container-low)',
                borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--outline-variant)',
                textAlign: 'center',
              }}>
                <div style={{ fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--slate)', marginBottom: '8px' }}>
                  Total Entries
                </div>
                <div style={{ fontSize: '28px', fontWeight: 700, color: 'var(--ink)', fontFamily: 'var(--font-mono)' }}>
                  {reviewEntries.length}
                </div>
              </div>

              {/* Score Distribution */}
              <div style={{
                padding: '20px',
                background: 'var(--surface-container-low)',
                borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--outline-variant)',
                textAlign: 'center',
              }}>
                <div style={{ fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--slate)', marginBottom: '10px' }}>
                  Distribution
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', fontSize: '13px' }}>
                  <span style={{ color: 'var(--confirm-green)', fontWeight: 600 }}>●&thinsp;{scoreDistribution.good}</span>
                  <span style={{ color: '#e8a317', fontWeight: 600 }}>●&thinsp;{scoreDistribution.medium}</span>
                  <span style={{ color: 'var(--conflict-red)', fontWeight: 600 }}>●&thinsp;{scoreDistribution.poor}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', fontSize: '10px', color: 'var(--slate)', marginTop: '4px' }}>
                  <span>Good</span>
                  <span>Medium</span>
                  <span>Poor</span>
                </div>
              </div>

              {/* Unsaved Changes */}
              <div style={{
                padding: '20px',
                background: hasEdits ? 'rgba(47,94,255,0.06)' : 'var(--surface-container-low)',
                borderRadius: 'var(--radius-lg)',
                border: `1px solid ${hasEdits ? 'rgba(47,94,255,0.15)' : 'var(--outline-variant)'}`,
                textAlign: 'center',
              }}>
                <div style={{ fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--slate)', marginBottom: '8px' }}>
                  Unsaved Edits
                </div>
                <div style={{ fontSize: '28px', fontWeight: 700, color: hasEdits ? 'var(--signal-blue)' : 'var(--slate)', fontFamily: 'var(--font-mono)' }}>
                  {Object.keys(editedEntries).length}
                </div>
              </div>
            </div>

            {/* ── Entries Review Table ── */}
            <div className="table-responsive" style={{ maxHeight: '500px', overflowY: 'auto', border: '1px solid var(--outline-variant)', borderRadius: 'var(--radius-lg)' }}>
              <table className="tt-table" style={{ fontSize: '12px' }}>
                <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
                  <tr>
                    <th style={{ width: '28px' }}></th>
                    <th>DAY</th>
                    <th>PERIOD</th>
                    <th>SUBJECT</th>
                    <th>CODE</th>
                    <th>TYPE</th>
                    <th>BATCH</th>
                    <th>FACULTY</th>
                    <th>ROOM</th>
                    <th style={{ width: '50px' }}>SCORE</th>
                    <th style={{ width: '40px', textAlign: 'center' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {reviewEntries.map((entry, idx) => {
                    const score = entry.parsing_score || 0;
                    const isLow = score < 50;
                    const isEdited = !!editedEntries[idx];

                    return (
                      <tr
                        key={entry.id || idx}
                        style={{
                          background: isLow ? 'rgba(224,49,49,0.04)' : isEdited ? 'rgba(47,94,255,0.04)' : undefined,
                          transition: 'background 200ms',
                        }}
                      >
                        <td style={{ textAlign: 'center' }}>
                          <ScoreDot score={score} />
                        </td>
                        <td>
                          <EditableCell
                            value={getEntryValue(idx, 'day')}
                            onChange={(v) => updateEntryField(idx, 'day', v)}
                            options={DAYS}
                            style={{ minWidth: '100px' }}
                          />
                        </td>
                        <td>
                          <EditableCell
                            value={getEntryValue(idx, 'period')}
                            onChange={(v) => updateEntryField(idx, 'period', parseInt(v))}
                            options={PERIOD_TIMES.map(p => p.period)}
                            style={{ minWidth: '50px' }}
                          />
                        </td>
                        <td>
                          <EditableCell
                            value={getEntryValue(idx, 'subject')}
                            onChange={(v) => updateEntryField(idx, 'subject', v)}
                            style={{ minWidth: '120px', fontWeight: 500 }}
                          />
                        </td>
                        <td>
                          <EditableCell
                            value={getEntryValue(idx, 'subject_code')}
                            onChange={(v) => updateEntryField(idx, 'subject_code', v)}
                            style={{ minWidth: '70px', fontFamily: 'var(--font-mono)' }}
                          />
                        </td>
                        <td>
                          <EditableCell
                            value={getEntryValue(idx, 'class_type')}
                            onChange={(v) => updateEntryField(idx, 'class_type', v)}
                            options={CLASS_TYPES}
                            style={{ minWidth: '80px' }}
                          />
                        </td>
                        <td>
                          <EditableCell
                            value={getEntryValue(idx, 'batch')}
                            onChange={(v) => updateEntryField(idx, 'batch', v)}
                            style={{ minWidth: '50px' }}
                          />
                        </td>
                        <td>
                          <EditableCell
                            value={getEntryValue(idx, 'faculty')}
                            onChange={(v) => updateEntryField(idx, 'faculty', v)}
                            style={{ minWidth: '100px' }}
                          />
                        </td>
                        <td>
                          <EditableCell
                            value={getEntryValue(idx, 'room')}
                            onChange={(v) => updateEntryField(idx, 'room', v)}
                            style={{ minWidth: '60px' }}
                          />
                        </td>
                        <td>
                          <ScoreBadge score={score} size="small" />
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteEntry(idx);
                            }}
                            style={{
                              background: 'none',
                              border: 'none',
                              cursor: 'pointer',
                              color: 'var(--slate)',
                              padding: '6px',
                              borderRadius: 'var(--radius)',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              transition: 'all 150ms',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.color = 'var(--conflict-red)';
                              e.currentTarget.style.background = 'rgba(224,49,49,0.1)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.color = 'var(--slate)';
                              e.currentTarget.style.background = 'none';
                            }}
                            title="Delete slot"
                            aria-label="Delete slot"
                          >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {reviewEntries.length === 0 && (
                    <tr>
                      <td colSpan={11} style={{ textAlign: 'center', color: 'var(--slate)', padding: '24px' }}>
                        No entries found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* ── Action Buttons ── */}
            <div style={{
              display: 'flex', gap: '12px', justifyContent: 'flex-end',
              marginTop: '20px', paddingTop: '16px',
              borderTop: '1px solid var(--outline-variant)',
            }}>
              {hasEdits && (
                <button
                  className="btn btn-secondary"
                  onClick={() => setEditedEntries({})}
                  disabled={savingReview}
                >
                  Discard Changes
                </button>
              )}
              <button
                className="btn btn-primary"
                onClick={handleSaveChanges}
                disabled={!hasEdits || savingReview}
                style={{
                  opacity: hasEdits ? 1 : 0.5,
                  display: 'flex', alignItems: 'center', gap: '6px',
                }}
              >
                {savingReview ? (
                  <>
                    <div style={{ width: '14px', height: '14px', border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                    Saving...
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                      <polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" />
                    </svg>
                    Save Changes ({Object.keys(editedEntries).length})
                  </>
                )}
              </button>
              <Link
                href="/assignment"
                className="btn btn-primary"
                style={{
                  background: 'var(--confirm-green)',
                  display: 'flex', alignItems: 'center', gap: '6px',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
                </svg>
                Finalize & Continue
              </Link>
            </div>
          </div>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          UPLOAD FORM — shown when NOT in review mode
          ══════════════════════════════════════════════════════════ */}
      {stage !== 'review' && (
        <>
          {/* 1. UPLOAD WINDOW & MARK AS UPLOADED */}
          <div className="tt-card" style={{ maxWidth: '720px', margin: '0 auto 36px auto' }}>
            <div className="tt-card-header">
              <h2 className="tt-card-title">Upload Timetable File</h2>
            </div>
            <div className="tt-card-body">
              {stage === 'success' ? (
                <div style={{ textAlign: 'center', padding: '16px 0' }}>
                  <div style={{ padding: '20px', background: 'rgba(30,158,107,0.1)', color: 'var(--confirm-green)', borderRadius: 'var(--radius-lg)', marginBottom: '20px', border: '1px solid rgba(30,158,107,0.2)' }}>
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ margin: '0 auto 12px', display: 'block' }}>
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                      <polyline points="22 4 12 14.01 9 11.01"></polyline>
                    </svg>
                    <h3 style={{ fontSize: '17px', fontWeight: 600, marginBottom: '6px', color: 'var(--ink)' }}>Marked as Uploaded!</h3>
                    <p style={{ fontSize: '14px' }}>{message}</p>
                  </div>
                  
                  <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                    <button className="btn btn-secondary" onClick={resetFlow}>Upload Another Timetable</button>
                    <Link href="/assignment" className="btn btn-primary">
                      Go to Room Assignment
                    </Link>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleUploadAndMark}>
                  {/* File Dropzone */}
                  <div 
                    className="upload-zone" 
                    onClick={() => stage !== 'processing' && document.getElementById('file-upload').click()}
                    style={{ 
                      pointerEvents: stage === 'processing' ? 'none' : 'auto', 
                      opacity: stage === 'processing' ? 0.6 : 1,
                      padding: '36px 24px',
                      marginBottom: '24px'
                    }}
                  >
                    <div className="upload-zone-icon">
                      <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                    </div>
                    <div className="upload-zone-title" style={{ color: file ? 'var(--signal-blue)' : 'inherit', fontSize: '16px' }}>
                      {file ? `Selected File: ${file.name}` : "Click or drag timetable file (PDF or DOCX) here"}
                    </div>
                    {!file && <div className="upload-zone-subtitle">Accepts PDF or DOCX format</div>}
                  </div>
                  
                  <input 
                    type="file" 
                    id="file-upload"
                    accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" 
                    onChange={handleFileChange}
                    style={{ display: 'none' }}
                  />

                  {/* Mark as Uploaded Selection */}
                  <div style={{ marginBottom: '24px', background: 'var(--surface-container-low)', padding: '16px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--outline-variant)' }}>
                    <label className="form-label" style={{ marginBottom: '8px' }}>
                      Mark as Uploaded For (Remaining Timetables):
                    </label>
                    
                    {pendingBatches.length > 0 ? (
                      <select 
                        className="form-select" 
                        value={selectedBatchId} 
                        onChange={(e) => setSelectedBatchId(e.target.value)}
                        disabled={stage === 'processing'}
                        style={{ fontWeight: 500 }}
                      >
                        {pendingBatches.map(batch => (
                          <option key={batch.id} value={batch.id}>
                            {batch.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div style={{ color: 'var(--confirm-green)', fontWeight: 500, padding: '6px 0' }}>
                        ✓ All timetables have been uploaded and marked!
                      </div>
                    )}
                  </div>

                  {stage === 'error' && (
                    <div style={{ padding: '12px 16px', background: 'var(--error-container)', color: 'var(--error)', borderRadius: 'var(--radius)', marginBottom: '20px', fontSize: '14px' }}>
                      {message}
                    </div>
                  )}

                  {stage === 'processing' ? (
                    <div style={{ textAlign: 'center', color: 'var(--slate)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', padding: '12px 0' }}>
                      <div style={{ width: '24px', height: '24px', border: '3px solid var(--outline-variant)', borderTopColor: 'var(--signal-blue)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                      <div style={{ fontSize: '14px', fontWeight: 500 }}>{message}</div>
                    </div>
                  ) : (
                    <button 
                      type="submit" 
                      className="btn btn-primary" 
                      disabled={!file || pendingBatches.length === 0}
                      style={{ width: '100%', padding: '12px 24px', fontSize: '15px', fontWeight: 600 }}
                    >
                      Upload & Mark as Uploaded
                    </button>
                  )}
                </form>
              )}
            </div>
          </div>
        </>
      )}

      {/* ══════════════════════════════════════════════════════════
          OVERVIEW & CHECKLIST OF ALL TIMETABLES
          ══════════════════════════════════════════════════════════ */}
      <div className="tt-card">
        <div className="tt-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <h2 className="tt-card-title">Timetable Upload Status ({uploadedCount} / {totalBatches} Uploaded)</h2>
            <div style={{ fontSize: '13px', color: 'var(--slate)', marginTop: '4px' }}>
              Overview of all courses, semesters, and divisions. Click "Review" to inspect parsed entries.
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button className={`btn ${categoryFilter === 'all' ? 'btn-primary' : 'btn-secondary'} btn-sm`} onClick={() => setCategoryFilter('all')}>All Courses</button>
            <button className={`btn ${categoryFilter === 'B.Pharm' ? 'btn-primary' : 'btn-secondary'} btn-sm`} onClick={() => setCategoryFilter('B.Pharm')}>B.Pharm</button>
            <button className={`btn ${categoryFilter === 'M.Pharm' ? 'btn-primary' : 'btn-secondary'} btn-sm`} onClick={() => setCategoryFilter('M.Pharm')}>M.Pharm</button>
            <button className={`btn ${categoryFilter === 'Pharm D' ? 'btn-primary' : 'btn-secondary'} btn-sm`} onClick={() => setCategoryFilter('Pharm D')}>Pharm D</button>
          </div>
        </div>

        {/* Progress Bar */}
        <div style={{ padding: '0 24px 16px 24px' }}>
          <div style={{ width: '100%', height: '8px', background: 'var(--surface-dim)', borderRadius: '4px', overflow: 'hidden' }}>
            <div style={{ width: `${progressPercent}%`, height: '100%', background: 'var(--confirm-green)', transition: 'width var(--transition-slow)' }}></div>
          </div>
        </div>

        <div className="tt-card-body p-0">
          <div className="table-responsive">
            <table className="tt-table">
              <thead>
                <tr>
                  <th style={{ width: '50px', textAlign: 'center' }}>STATUS</th>
                  <th>TIMETABLE BATCH</th>
                  <th>PROGRAM</th>
                  <th>SEM / YEAR</th>
                  <th>FILE NAME IN SUPABASE</th>
                  <th>PARSED SLOTS</th>
                  <th>PARSE SCORE</th>
                  <th style={{ textAlign: 'right' }}>ACTION</th>
                </tr>
              </thead>
              <tbody>
                {filteredBatches.map((batch) => {
                  const upload = uploadedBatchMap.get(batch.id);
                  const isUploaded = !!upload;

                  return (
                    <tr key={batch.id} style={{ background: isUploaded ? 'rgba(30,158,107,0.03)' : undefined }}>
                      <td style={{ textAlign: 'center' }}>
                        <div
                          style={{
                            width: '22px', height: '22px', borderRadius: 'var(--radius)',
                            border: isUploaded ? 'none' : '2px solid var(--outline-variant)',
                            background: isUploaded ? 'var(--confirm-green)' : 'transparent',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto'
                          }}
                        >
                          {isUploaded && (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </div>
                      </td>
                      <td style={{ fontWeight: 600 }}>{batch.label}</td>
                      <td>{batch.program}</td>
                      <td>{batch.category === 'Pharm D' ? `Year ${batch.semester}` : `Sem ${batch.semester}`}</td>
                      <td>
                        {isUploaded ? (
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'var(--ink)' }}>
                            {upload.original_filename}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--slate)', fontSize: '13px' }}>—</span>
                        )}
                      </td>
                      <td>
                        {isUploaded ? (
                          <span className="status-badge status-success">
                            {upload.slotsCount} SLOTS
                          </span>
                        ) : (
                          <span style={{ color: 'var(--slate)', fontSize: '13px' }}>Pending</span>
                        )}
                      </td>
                      <td>
                        {isUploaded && upload.overallParsingScore > 0 ? (
                          <ScoreBadge score={upload.overallParsingScore} size="small" />
                        ) : isUploaded ? (
                          <span style={{ color: 'var(--slate)', fontSize: '12px' }}>—</span>
                        ) : null}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {isUploaded ? (
                          <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                            <button
                              onClick={() => handleReviewExisting(upload.id, batch.label)}
                              className="btn btn-secondary btn-sm"
                              style={{ fontSize: '12px' }}
                              title="Review and edit parsed entries"
                            >
                              Review
                            </button>
                            <button
                              onClick={() => handleDelete(upload.id, batch.label)}
                              className="btn btn-secondary btn-sm"
                              style={{ color: 'var(--conflict-red)', borderColor: '#ffcdd2', fontSize: '12px' }}
                              title="Delete upload from Supabase to re-upload"
                            >
                              Delete
                            </button>
                          </div>
                        ) : (
                          <span style={{ fontSize: '12px', color: 'var(--slate)' }}>
                            Upload above
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
