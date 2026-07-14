'use client';
import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useUploadTracker } from '../../context/UploadTrackerContext';
import { useAuth } from '../../context/AuthContext';

export default function UploadPage() {
  const { user } = useAuth();
  const {
    ALL_BATCHES,
    markUploaded,
    removeUpload,
    isUploaded,
    getUploadInfo,
    stats,
  } = useUploadTracker();

  const [stage, setStage] = useState('idle'); // idle | processing | done
  const [fileName, setFileName] = useState('');
  const [courseFilter, setCourseFilter] = useState('all');
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(null);
  const [selectedBatch, setSelectedBatch] = useState('');

  const handleDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0] || e.target?.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setStage('processing');
    setTimeout(() => setStage('done'), 2500);
  };

  const handleMarkUploaded = (batchId) => {
    markUploaded(batchId, fileName || 'Manual entry', user?.name || 'Unknown');
  };

  const handleRemove = (batchId) => {
    removeUpload(batchId);
    setShowRemoveConfirm(null);
  };

  const filteredBatches = useMemo(() => {
    if (courseFilter === 'all') return ALL_BATCHES;
    return ALL_BATCHES.filter(b => b.course === courseFilter);
  }, [courseFilter, ALL_BATCHES]);

  // Group batches by course
  const groupedBatches = useMemo(() => {
    const groups = {};
    for (const b of filteredBatches) {
      if (!groups[b.course]) groups[b.course] = [];
      groups[b.course].push(b);
    }
    return groups;
  }, [filteredBatches]);

  const progressPercent = stats.total > 0 ? Math.round((stats.uploaded / stats.total) * 100) : 0;

  return (
    <>
      <div className="page-header">
        <div className="page-header-left">
          <h1>Upload Timetable</h1>
          <p>Upload timetable PDFs and track which batches have been uploaded</p>
        </div>
      </div>

      <div className="page-body">
        {/* Upload Section */}
        {stage === 'idle' && (
          <label
            className="upload-zone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            htmlFor="file-input"
          >
            <div className="upload-zone-icon">
              <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            </div>
            <div className="upload-zone-title">Drop PDF here or click to browse</div>
            <div className="upload-zone-subtitle">Supports single timetable PDF per upload. Data is extracted and stored automatically.</div>
            <input id="file-input" type="file" accept=".pdf" onChange={handleDrop} style={{ display: 'none' }} />
          </label>
        )}

        {stage === 'processing' && (
          <div className="card" style={{ textAlign: 'center', padding: '48px' }}>
            <div className="pulse" style={{ marginBottom: '16px' }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--signal-blue)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>
              </svg>
            </div>
            <div className="headline-md" style={{ marginBottom: '8px' }}>Extracting slots…</div>
            <div className="body-sm" style={{ color: 'var(--slate)' }}>
              Processing <span className="data-tabular">{fileName}</span>
            </div>
          </div>
        )}

        {stage === 'done' && (
          <>
            <div className="alert alert-success">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
              <div>
                <strong>Timetable uploaded</strong> — <span className="data-tabular">{fileName}</span>. Now mark the corresponding batch(es) below.
              </div>
            </div>

            {/* Batch selector for quick mark */}
            <div className="card" style={{ marginBottom: '16px', padding: '20px' }}>
              <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px', color: 'var(--ink)' }}>
                Mark batch for uploaded file
              </div>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: '250px' }}>
                  <label className="form-label" htmlFor="batch-select">Select batch</label>
                  <select
                    id="batch-select"
                    className="form-select"
                    value={selectedBatch}
                    onChange={(e) => setSelectedBatch(e.target.value)}
                  >
                    <option value="">Choose a batch…</option>
                    {ALL_BATCHES.filter(b => !isUploaded(b.id)).map(b => (
                      <option key={b.id} value={b.id}>{b.label}</option>
                    ))}
                  </select>
                </div>
                <button
                  className="btn btn-primary"
                  disabled={!selectedBatch}
                  onClick={() => {
                    if (selectedBatch) {
                      handleMarkUploaded(selectedBatch);
                      setSelectedBatch('');
                    }
                  }}
                  style={{ height: '38px' }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Mark as uploaded
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
              <Link href="/assignment" className="btn btn-primary">View on Timetable & Assignment</Link>
              <button className="btn btn-secondary" onClick={() => { setStage('idle'); setFileName(''); }}>Upload another</button>
            </div>
          </>
        )}

        {/* ─── UPLOAD CHECKLIST ─── */}
        <div style={{ marginTop: '32px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <div className="headline-md">Upload Checklist</div>
              <div style={{ fontSize: '13px', color: 'var(--slate)', marginTop: '4px' }}>
                Track which timetables have been uploaded for each batch
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <select
                className="filter-select"
                value={courseFilter}
                onChange={(e) => setCourseFilter(e.target.value)}
              >
                <option value="all">All Courses</option>
                <option value="B.Pharm">B.Pharm</option>
                <option value="M.Pharm">M.Pharm</option>
                <option value="Pharm D">Pharm D</option>
              </select>
            </div>
          </div>

          {/* Progress Overview */}
          <div className="stat-grid" style={{ marginBottom: '24px' }}>
            <div className="stat-card">
              <div className="stat-card-label">Overall progress</div>
              <div className="stat-card-value" style={{ fontSize: '24px' }}>
                {stats.uploaded} / {stats.total}
              </div>
              <div style={{
                marginTop: '12px',
                height: '6px',
                background: 'var(--surface-container-high)',
                borderRadius: 'var(--radius-full)',
                overflow: 'hidden',
              }}>
                <div style={{
                  width: `${progressPercent}%`,
                  height: '100%',
                  background: progressPercent === 100 ? 'var(--confirm-green)' : 'var(--signal-blue)',
                  borderRadius: 'var(--radius-full)',
                  transition: 'width 0.5s ease',
                }} />
              </div>
              <div className="stat-card-footer">{progressPercent}% complete</div>
            </div>
            <div className="stat-card">
              <div className="stat-card-label">B.Pharm</div>
              <div className="stat-card-value" style={{ fontSize: '24px', color: stats.bpharmUploaded === stats.bpharmTotal ? 'var(--confirm-green)' : 'var(--ink)' }}>
                {stats.bpharmUploaded} / {stats.bpharmTotal}
              </div>
              <div className="stat-card-footer">Sem 1, 3, 5, 7 × Div A, B</div>
            </div>
            <div className="stat-card">
              <div className="stat-card-label">M.Pharm</div>
              <div className="stat-card-value" style={{ fontSize: '24px', color: stats.mpharmUploaded === stats.mpharmTotal ? 'var(--confirm-green)' : 'var(--ink)' }}>
                {stats.mpharmUploaded} / {stats.mpharmTotal}
              </div>
              <div className="stat-card-footer">Sem 1, 3 × 9 specializations</div>
            </div>
            <div className="stat-card">
              <div className="stat-card-label">Pharm D</div>
              <div className="stat-card-value" style={{ fontSize: '24px', color: stats.pharmdUploaded === stats.pharmdTotal ? 'var(--confirm-green)' : 'var(--ink)' }}>
                {stats.pharmdUploaded} / {stats.pharmdTotal}
              </div>
              <div className="stat-card-footer">Year 1–5 (Annual)</div>
            </div>
          </div>

          {/* Checklist Table */}
          {Object.entries(groupedBatches).map(([course, batches]) => (
            <div key={course} className="card" style={{ marginBottom: '16px', padding: 0, overflow: 'hidden' }}>
              <div style={{
                padding: '14px 20px',
                background: 'var(--surface-container-low)',
                borderBottom: '1px solid var(--outline-variant)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span className={`badge ${course === 'B.Pharm' ? 'badge-general' : course === 'M.Pharm' ? 'badge-lab' : 'badge-partial'}`}>
                    {course}
                  </span>
                  <span style={{ fontSize: '13px', color: 'var(--slate)' }}>
                    {batches.filter(b => isUploaded(b.id)).length} of {batches.length} uploaded
                  </span>
                </div>
                {batches.every(b => isUploaded(b.id)) && (
                  <span className="badge badge-assigned">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Complete
                  </span>
                )}
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: '48px', textAlign: 'center' }}>Status</th>
                    <th>Batch / Division</th>
                    <th>Students</th>
                    <th>File</th>
                    <th>Uploaded by</th>
                    <th>Date</th>
                    <th style={{ width: '100px' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map(batch => {
                    const uploaded = isUploaded(batch.id);
                    const info = getUploadInfo(batch.id);
                    return (
                      <tr key={batch.id} style={{ background: uploaded ? 'rgba(30,158,107,0.03)' : undefined }}>
                        <td style={{ textAlign: 'center' }}>
                          <div
                            style={{
                              width: '22px',
                              height: '22px',
                              borderRadius: 'var(--radius)',
                              border: uploaded ? 'none' : '2px solid var(--outline-variant)',
                              background: uploaded ? 'var(--confirm-green)' : 'transparent',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              margin: '0 auto',
                              transition: 'all var(--transition-fast)',
                              cursor: uploaded ? 'default' : 'not-allowed',
                            }}
                            title={uploaded ? `Uploaded: ${info?.fileName}` : 'Not uploaded — upload a timetable first, then mark this batch'}
                          >
                            {uploaded && (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            )}
                          </div>
                        </td>
                        <td>
                          <div style={{ fontWeight: 500, fontSize: '14px' }}>{batch.label}</div>
                          <div style={{ fontSize: '12px', color: 'var(--slate)', marginTop: '2px' }}>
                            {batch.type === 'semester' ? `Semester ${batch.semester}` : `Year ${batch.year}`}
                            {batch.division && ` · Division ${batch.division}`}
                            {batch.specialization && ` · ${batch.specialization}`}
                          </div>
                        </td>
                        <td className="mono" style={{ fontSize: '13px' }}>≤ {batch.maxStudents}</td>
                        <td>
                          {info ? (
                            <span className="data-tabular" style={{ fontSize: '12px' }}>{info.fileName}</span>
                          ) : (
                            <span style={{ color: 'var(--slate)', fontSize: '13px' }}>—</span>
                          )}
                        </td>
                        <td>
                          {info ? (
                            <span style={{ fontSize: '13px' }}>{info.uploadedBy}</span>
                          ) : (
                            <span style={{ color: 'var(--slate)', fontSize: '13px' }}>—</span>
                          )}
                        </td>
                        <td>
                          {info ? (
                            <span className="mono" style={{ fontSize: '12px' }}>
                              {new Date(info.uploadedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--slate)', fontSize: '13px' }}>—</span>
                          )}
                        </td>
                        <td>
                          {uploaded ? (
                            <>
                              {showRemoveConfirm === batch.id ? (
                                <div style={{ display: 'flex', gap: '4px' }}>
                                  <button
                                    className="btn btn-danger btn-sm"
                                    onClick={() => handleRemove(batch.id)}
                                    style={{ fontSize: '11px', padding: '3px 8px' }}
                                  >
                                    Confirm
                                  </button>
                                  <button
                                    className="btn btn-ghost btn-sm"
                                    onClick={() => setShowRemoveConfirm(null)}
                                    style={{ fontSize: '11px', padding: '3px 8px' }}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <button
                                  className="btn btn-ghost btn-sm"
                                  onClick={() => setShowRemoveConfirm(batch.id)}
                                  style={{ color: 'var(--conflict-red)', fontSize: '12px' }}
                                  title="Remove upload — this will uncheck the batch"
                                >
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                                  </svg>
                                  Remove
                                </button>
                              )}
                            </>
                          ) : (
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() => handleMarkUploaded(batch.id)}
                              style={{ color: 'var(--signal-blue)', fontSize: '12px' }}
                              title="Mark this batch as uploaded"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                              </svg>
                              Mark
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}

          {/* Legend */}
          <div style={{
            padding: '16px 20px',
            background: 'var(--surface-container-low)',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--outline-variant)',
            fontSize: '13px',
            color: 'var(--slate)',
            display: 'flex',
            gap: '24px',
            flexWrap: 'wrap',
            alignItems: 'center',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ width: '18px', height: '18px', borderRadius: 'var(--radius)', background: 'var(--confirm-green)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              </div>
              Uploaded
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ width: '18px', height: '18px', borderRadius: 'var(--radius)', border: '2px solid var(--outline-variant)' }} />
              Pending
            </div>
            <div style={{ marginLeft: 'auto', fontStyle: 'italic' }}>
              ⓘ Checked batches can only be unchecked by removing the uploaded timetable
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
