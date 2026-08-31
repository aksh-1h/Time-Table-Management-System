import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '../../../lib/supabase-server';

const PARSER_SERVICE_URL = process.env.PARSER_SERVICE_URL || 'http://localhost:8000';

/**
 * POST /api/schedules/upload
 * 
 * Sends the uploaded timetable file to the Python parser service
 * for accurate DOCX/PDF/JSON parsing via python-docx + pdfplumber.
 * 
 * Requires: Python parser service running at PARSER_SERVICE_URL
 *   Start with: .\parser-service\venv\Scripts\python.exe parser-service\main.py
 */
export async function POST(request) {
  const supabase = createServerSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const program = formData.get('program');
    const semester = parseInt(formData.get('semester'));
    const division = formData.get('division') || null;

    if (!file || !program || !semester) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const originalFilename = file.name;
    const storagePath = `${program}/Sem_${semester}/${Date.now()}_${originalFilename}`;

    // 1. Clean up any existing uploads for this program/semester/division
    let existingQuery = supabase.from('timetable_uploads')
      .select('id, file_path')
      .eq('program', program)
      .eq('semester', semester);

    if (division) {
      existingQuery = existingQuery.eq('division', division);
    } else {
      existingQuery = existingQuery.is('division', null);
    }

    const { data: existingUploads } = await existingQuery;

    if (existingUploads && existingUploads.length > 0) {
      const pathsToRemove = existingUploads.map(e => e.file_path).filter(Boolean);
      const idsToDelete = existingUploads.map(e => e.id);
      await Promise.all([
        pathsToRemove.length > 0 ? supabase.storage.from('timetables').remove(pathsToRemove) : Promise.resolve(),
        supabase.from('timetable_uploads').delete().in('id', idsToDelete)
      ]);
    }

    // 2. Upload raw file to Supabase Storage
    const { error: storageError } = await supabase.storage
      .from('timetables')
      .upload(storagePath, buffer, { contentType: file.type || 'application/octet-stream', upsert: true });

    if (storageError) {
      console.error('Supabase Storage error:', storageError);
      return NextResponse.json({ error: `Storage upload failed: ${storageError.message}` }, { status: 500 });
    }

    // 3. Insert upload record
    const { data: uploadRecord, error: uploadError } = await supabase
      .from('timetable_uploads')
      .insert({
        file_path: storagePath,
        original_filename: originalFilename,
        program,
        semester,
        division,
        status: 'pending'
      })
      .select()
      .single();

    if (uploadError) {
      console.error('Supabase DB insert error:', uploadError);
      return NextResponse.json({ error: `Database insert failed: ${uploadError.message}` }, { status: 500 });
    }

    // 4. Send file to Python parser service
    let parserResult;
    try {
      const pyFormData = new FormData();
      pyFormData.append('file', new Blob([buffer]), originalFilename);
      pyFormData.append('program', program);
      pyFormData.append('semester', String(semester));
      if (division) pyFormData.append('division', division);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout for large files

      const pyResponse = await fetch(`${PARSER_SERVICE_URL}/parse-timetable`, {
        method: 'POST',
        body: pyFormData,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!pyResponse.ok) {
        const errText = await pyResponse.text().catch(() => 'unknown error');
        throw new Error(`Parser returned HTTP ${pyResponse.status}: ${errText}`);
      }

      parserResult = await pyResponse.json();
      console.log(`[upload] Python parser: ${parserResult.count} entries, parser=${parserResult.parser}, score=${parserResult.overall_parsing_score}%`);

    } catch (pyError) {
      console.error(`[upload] Python parser error: ${pyError.message}`);
      await Promise.all([
        supabase.storage.from('timetables').remove([storagePath]),
        supabase.from('timetable_uploads').delete().eq('id', uploadRecord.id)
      ]);

      const isConnectionError = pyError.message.includes('fetch failed')
        || pyError.message.includes('ECONNREFUSED')
        || pyError.message.includes('aborted')
        || pyError.name === 'AbortError';

      if (isConnectionError) {
        return NextResponse.json({
          error: 'Python parser service is not running. Start it with: .\\parser-service\\venv\\Scripts\\python.exe parser-service\\main.py'
        }, { status: 503 });
      }

      return NextResponse.json({ error: `Parser error: ${pyError.message}` }, { status: 500 });
    }

    const entries = parserResult.entries || [];
    const overallParsingScore = parserResult.overall_parsing_score || 0;

    // 5. Save parsed entries to database
    if (entries.length > 0) {
      const entriesWithUploadId = entries.map(e => ({
        upload_id: uploadRecord.id,
        day: e.day,
        period: e.period,
        start_time: e.start_time || null,
        end_time: e.end_time || null,
        subject: e.subject,
        subject_code: e.subject_code || e.code || null,
        class_type: e.class_type || e.type || 'theory',
        batch: e.batch || 'ALL',
        faculty: e.faculty || null,
        room: e.room || null,
        parsing_score: e.parsing_score || 0
      }));

      const { error: insertError } = await supabase.from('timetable_entries').insert(entriesWithUploadId);

      if (insertError) {
        console.error('Error inserting entries:', insertError);
        await Promise.all([
          supabase.storage.from('timetables').remove([storagePath]),
          supabase.from('timetable_uploads').delete().eq('id', uploadRecord.id)
        ]);
        return NextResponse.json({ error: `Failed to insert slots: ${insertError.message}` }, { status: 500 });
      }

      await supabase.from('timetable_uploads').update({
        status: 'parsed',
        overall_parsing_score: overallParsingScore
      }).eq('id', uploadRecord.id);

      return NextResponse.json({
        success: true,
        message: `Parsed ${entries.length} slots via Python (${parserResult.parser}). Quality: ${overallParsingScore}%`,
        id: uploadRecord.id,
        slotsCount: entries.length,
        overallParsingScore,
        parserSource: 'python',
        entries: entries.map(e => ({
          day: e.day,
          period: e.period,
          start_time: e.start_time,
          end_time: e.end_time,
          subject: e.subject,
          subject_code: e.subject_code,
          class_type: e.class_type,
          batch: e.batch,
          faculty: e.faculty,
          room: e.room,
          parsing_score: e.parsing_score || 0
        }))
      });
    } else {
      await Promise.all([
        supabase.storage.from('timetables').remove([storagePath]),
        supabase.from('timetable_uploads').delete().eq('id', uploadRecord.id)
      ]);
      return NextResponse.json({
        error: 'No valid timetable entries could be extracted. Try a different file format.'
      }, { status: 400 });
    }

  } catch (err) {
    console.error('Server upload error:', err);
    return NextResponse.json({ error: `Internal server error: ${err.message}` }, { status: 500 });
  }
}
