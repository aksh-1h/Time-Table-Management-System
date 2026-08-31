'use client';
import { createContext, useContext, useState, useEffect } from 'react';

const UploadTrackerContext = createContext(null);

// Build the complete batch list from the README
// B.Pharm: Semesters 1,3,5,7 × Division A, Division B
// M.Pharm: Semesters 1,3 × 9 specializations
// Pharm D: Years 1–5 (annual system)
function buildBatchList() {
  const batches = [];

  // B.Pharm batches
  const bpharmSemesters = [1, 3, 5, 7];
  const bpharmDivisions = ['A', 'B'];
  for (const sem of bpharmSemesters) {
    for (const div of bpharmDivisions) {
      batches.push({
        id: `bpharm-sem${sem}-div${div}`,
        course: 'B.Pharm',
        label: `B.Pharm — Sem ${sem} — Division ${div}`,
        semester: sem,
        division: div,
        maxStudents: 60,
        type: 'semester',
      });
    }
  }

  // M.Pharm batches
  const mpharmSemesters = [1, 3];
  const mpharmSpecializations = [
    'Pharmaceutics',
    'Pharmachemistry',
    'Pharmacology',
    'QA',
    'Techno',
    'PA',
    'RA',
    'PP',
    'Phyto',
  ];
  for (const sem of mpharmSemesters) {
    for (const spec of mpharmSpecializations) {
      const specShort = spec.replace(/\s+/g, '-').toLowerCase();
      batches.push({
        id: `mpharm-sem${sem}-${specShort}`,
        course: 'M.Pharm',
        label: `M.Pharm — Sem ${sem} — ${spec}`,
        semester: sem,
        specialization: spec,
        maxStudents: 15,
        type: 'semester',
      });
    }
  }

  // Pharm D batches
  for (let year = 1; year <= 5; year++) {
    batches.push({
      id: `pharmd-year${year}`,
      course: 'Pharm D',
      label: `Pharm D — Year ${year}`,
      year: year,
      maxStudents: 40,
      type: 'annual',
    });
  }

  return batches;
}

const ALL_BATCHES = buildBatchList();

export function UploadTrackerProvider({ children }) {
  const [uploadedBatches, setUploadedBatches] = useState({});
  // Each entry: { batchId: { fileName, uploadedAt, uploadedBy } }

  useEffect(() => {
    try {
      const stored = localStorage.getItem('tt_fop_uploads');
      if (stored) {
        setUploadedBatches(JSON.parse(stored));
      }
    } catch (e) {}
  }, []);

  const persist = (data) => {
    localStorage.setItem('tt_fop_uploads', JSON.stringify(data));
  };

  const markUploaded = (batchId, fileName, uploadedBy) => {
    setUploadedBatches(prev => {
      const next = {
        ...prev,
        [batchId]: {
          fileName,
          uploadedAt: new Date().toISOString(),
          uploadedBy: uploadedBy || 'Unknown',
        },
      };
      persist(next);
      return next;
    });
  };

  const removeUpload = (batchId) => {
    setUploadedBatches(prev => {
      const next = { ...prev };
      delete next[batchId];
      persist(next);
      return next;
    });
  };

  const isUploaded = (batchId) => !!uploadedBatches[batchId];
  const getUploadInfo = (batchId) => uploadedBatches[batchId] || null;

  const stats = {
    total: ALL_BATCHES.length,
    uploaded: Object.keys(uploadedBatches).length,
    pending: ALL_BATCHES.length - Object.keys(uploadedBatches).length,
    bpharmTotal: ALL_BATCHES.filter(b => b.course === 'B.Pharm').length,
    bpharmUploaded: ALL_BATCHES.filter(b => b.course === 'B.Pharm' && uploadedBatches[b.id]).length,
    mpharmTotal: ALL_BATCHES.filter(b => b.course === 'M.Pharm').length,
    mpharmUploaded: ALL_BATCHES.filter(b => b.course === 'M.Pharm' && uploadedBatches[b.id]).length,
    pharmdTotal: ALL_BATCHES.filter(b => b.course === 'Pharm D').length,
    pharmdUploaded: ALL_BATCHES.filter(b => b.course === 'Pharm D' && uploadedBatches[b.id]).length,
  };

  return (
    <UploadTrackerContext.Provider value={{
      ALL_BATCHES,
      uploadedBatches,
      markUploaded,
      removeUpload,
      isUploaded,
      getUploadInfo,
      stats,
    }}>
      {children}
    </UploadTrackerContext.Provider>
  );
}

export function useUploadTracker() {
  const ctx = useContext(UploadTrackerContext);
  if (!ctx) throw new Error('useUploadTracker must be used within UploadTrackerProvider');
  return ctx;
}

export { ALL_BATCHES };
