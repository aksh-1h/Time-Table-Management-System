'use client';
import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';

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
    'Pharmaceutics', 'Pharmacology', 'Pharmaceutical Chemistry',
    'Pharmacognosy', 'Quality Assurance', 'Industrial Pharmacy',
    'Pharmacy Practice', 'Regulatory Affairs', 'Clinical Research'
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

  // 3. Pharm D: Years 1–5 (Annual system)
  for (let year = 1; year <= 5; year++) {
    batches.push({
      id: `PharmD-year${year}`,
      program: 'Pharm D',
      semester: year,
      division: 'A',
      label: `Pharm D — Year ${year} (Division A)`,
      category: 'Pharm D'
    });
  }

  return batches;
}

const ALL_BATCHES = buildAllBatches();

export default function UploadPage() {
  const [file, setFile] = useState(null);
  const [selectedBatchId, setSelectedBatchId] = useState('');
  
  const [stage, setStage] = useState('idle'); // idle | processing | success | error
  const [message, setMessage] = useState('');
  const [storedSchedules, setStoredSchedules] = useState([]);
  const [categoryFilter, setCategoryFilter] = useState('all');

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
      const key = `${sched.program}-sem${sched.semester}-div${sched.division || 'A'}`;
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

      setStage('success');
      setMessage(data.message || `Timetable uploaded and marked for ${batch.label}`);
      setFile(null);
      
      const fileInput = document.getElementById('file-upload');
      if (fileInput) fileInput.value = '';

      fetchScheduleList();
    } catch (err) {
      setStage('error');
      setMessage(err.message);
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
  };

  const totalBatches = ALL_BATCHES.length;
  const uploadedCount = storedSchedules.length;
  const progressPercent = Math.round((uploadedCount / totalBatches) * 100);

  const filteredBatches = useMemo(() => {
    if (categoryFilter === 'all') return ALL_BATCHES;
    return ALL_BATCHES.filter(b => b.category === categoryFilter);
  }, [categoryFilter]);

  return (
    <div className="page-body">
      <div className="page-header" style={{ marginBottom: '32px' }}>
        <div>
          <h1 className="page-title">Upload Timetables</h1>
          <p className="page-subtitle">Upload timetable files to Supabase and mark them for each course & division.</p>
        </div>
      </div>

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

      {/* 2. OVERVIEW & CHECKLIST OF ALL TIMETABLES */}
      <div className="tt-card">
        <div className="tt-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <h2 className="tt-card-title">Timetable Upload Status ({uploadedCount} / {totalBatches} Uploaded)</h2>
            <div style={{ fontSize: '13px', color: 'var(--slate)', marginTop: '4px' }}>
              Overview of all courses, semesters, and divisions. Use Delete to remove an upload and re-upload.
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
                      <td style={{ textAlign: 'right' }}>
                        {isUploaded ? (
                          <button
                            onClick={() => handleDelete(upload.id, batch.label)}
                            className="btn btn-secondary btn-sm"
                            style={{ color: 'var(--conflict-red)', borderColor: '#ffcdd2', fontSize: '12px' }}
                            title="Delete upload from Supabase to re-upload"
                          >
                            Delete
                          </button>
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
