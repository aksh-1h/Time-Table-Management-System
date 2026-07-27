import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '../../../lib/supabase-server';

export async function GET() {
  const supabase = createServerSupabaseClient();

  if (supabase) {
    try {
      const { data, error } = await supabase.from('slot_assignments').select('program, semester, division');
      if (!error && data && data.length > 0) {
        const programs = [...new Set(data.map(s => s.program))].filter(Boolean).sort();
        const semesters = [...new Set(data.map(s => s.semester))].filter(Boolean).sort((a,b)=>a-b);
        const divisions = [...new Set(data.map(s => s.division))].filter(Boolean).sort();
        if (programs.length > 0 && semesters.length > 0 && divisions.length > 0) {
          return NextResponse.json({ programs, semesters, divisions });
        }
      }
    } catch (e) {
      // Fallback
    }
  }

  // JSON / Default options fallback
  let programs = ['B.Pharm', 'M.Pharm', 'Pharm D'];
  let semesters = [1, 2, 3, 4, 5, 6, 7, 8];
  let divisions = ['A', 'B'];

  try {
    const { parseFacultySubjectsData } = require('../../../lib/data-parser');
    const { subjects, assignments } = parseFacultySubjectsData();
    
    if (subjects && subjects.length > 0) {
      const p = [...new Set(subjects.map(s => s.program))].filter(Boolean).sort();
      if (p.length > 0) programs = p;
      const s = [...new Set(subjects.map(s => s.semester))].filter(Boolean).sort((a,b)=>a-b);
      if (s.length > 0) semesters = s;
    }
    
    const divs = new Set();
    for (const a of assignments || []) {
      if (a.division) divs.add(a.division);
    }
    if (divs.size > 0) divisions = [...divs].sort();
  } catch (e) {}

  return NextResponse.json({ programs, semesters, divisions });
}

