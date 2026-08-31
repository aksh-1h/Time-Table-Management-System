import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '../../../lib/supabase-server';

/**
 * M.Pharm specializations list (9 specializations)
 */
const MPHARM_SPECIALIZATIONS = [
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

export async function GET() {
  const supabase = createServerSupabaseClient();

  // Default options
  let programs = ['B.Pharm', 'M.Pharm', 'Pharm D'];
  let semesters = [1, 2, 3, 4, 5, 6, 7, 8];
  let divisions = ['A', 'B'];
  let mpharmSpecializations = [...MPHARM_SPECIALIZATIONS];

  // Try to get actual uploaded data from timetable_uploads
  if (supabase) {
    try {
      const { data: uploads, error } = await supabase
        .from('timetable_uploads')
        .select('program, semester, division');

      if (!error && uploads && uploads.length > 0) {
        const p = [...new Set(uploads.map(u => u.program))].filter(Boolean).sort();
        if (p.length > 0) programs = p;

        const s = [...new Set(uploads.map(u => u.semester))].filter(Boolean).sort((a, b) => a - b);
        if (s.length > 0) semesters = s;

        // Collect B.Pharm divisions (A, B) and M.Pharm specializations separately
        const bpharmDivs = new Set();
        const mpharmSpecs = new Set();

        for (const u of uploads) {
          if (u.program === 'B.Pharm' && u.division) {
            bpharmDivs.add(u.division);
          }
          if (u.program === 'M.Pharm' && u.division) {
            mpharmSpecs.add(u.division);
          }
        }

        if (bpharmDivs.size > 0) divisions = [...bpharmDivs].sort();
        const allSpecs = new Set([...MPHARM_SPECIALIZATIONS, ...mpharmSpecs]);
        mpharmSpecializations = [...allSpecs];
      }
    } catch (e) {
      // Fallback to defaults
    }
  }

  // Enrich options from Supabase subjects table
  if (supabase) {
    try {
      const { data: subjects, error } = await supabase.from('subjects').select('program, semester');
      if (!error && subjects && subjects.length > 0) {
        const p = [...new Set(subjects.map(s => s.program))].filter(Boolean).sort();
        if (p.length > 0 && programs.length <= 3) programs = p;
        const s = [...new Set(subjects.map(s => s.semester))].filter(Boolean).sort((a, b) => a - b);
        if (s.length > 0) semesters = s;
      }
    } catch (e) {}
  }

  return NextResponse.json({
    programs,
    semesters,
    divisions,
    mpharmSpecializations,
  });
}
