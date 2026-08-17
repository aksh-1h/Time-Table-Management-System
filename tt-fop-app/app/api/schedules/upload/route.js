import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '../../../lib/supabase-server';
import { processTimetableFile } from '../../../lib/timetable-parser';

/**
 * POST /api/schedules/upload
 * Handles file upload, saves raw file to Supabase Storage ('timetables'),
 * parses timetable entries using the EMBEDDED JavaScript parser (no external service),
 * and inserts parsed entries to DB with quality scores.
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

    // 1. Delete any existing upload for this program/semester/division combo in parallel
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

    // 2. Upload raw file to Supabase Storage bucket 'timetables'
    const { data: storageData, error: storageError } = await supabase.storage
      .from('timetables')
      .upload(storagePath, buffer, { contentType: file.type || 'application/octet-stream', upsert: true });

    if (storageError) {
      console.error('Supabase Storage error:', storageError);
      return NextResponse.json({ error: `Storage upload failed: ${storageError.message}` }, { status: 500 });
    }

    // 3. Insert fresh upload record
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
      console.error('Supabase DB upload insert error:', uploadError);
      return NextResponse.json({ error: `Database insert failed: ${uploadError.message}` }, { status: 500 });
    }

    // 3. Parse timetable using EMBEDDED JavaScript parser (no external service needed)
    let parserResult;
    try {
      parserResult = processTimetableFile(buffer, originalFilename, program, semester, division);
    } catch (parseError) {
      console.error('[upload] Parser error:', parseError);
      await supabase.from('timetable_uploads').update({ status: 'failed' }).eq('id', uploadRecord.id);
      return NextResponse.json({
        error: `Parser error: ${parseError.message}`
      }, { status: 500 });
    }

    const entries = parserResult.entries || [];
    const parserUsed = parserResult.parser || 'unknown';
    const overallParsingScore = parserResult.overall_parsing_score || 0;

    // 4. Save parsed entries to timetable_entries table in Supabase
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
        console.error('Error inserting entries to Supabase:', insertError);
        await supabase.from('timetable_uploads').update({ status: 'failed' }).eq('id', uploadRecord.id);
        return NextResponse.json({ error: `Failed to insert slots: ${insertError.message}` }, { status: 500 });
      }

      await supabase.from('timetable_uploads').update({
        status: 'parsed',
        overall_parsing_score: overallParsingScore
      }).eq('id', uploadRecord.id);

      return NextResponse.json({
        success: true,
        message: `Successfully uploaded & parsed ${entries.length} slots (${parserUsed} parser). Overall quality: ${overallParsingScore}%`,
        id: uploadRecord.id,
        slotsCount: entries.length,
        overallParsingScore,
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
      await supabase.from('timetable_uploads').update({ status: 'failed' }).eq('id', uploadRecord.id);
      return NextResponse.json({
        error: 'File uploaded to storage but no valid timetable entries could be extracted. Try a different file format.'
      }, { status: 400 });
    }

  } catch (err) {
    console.error('Server upload error:', err);
    return NextResponse.json({ error: `Internal server error: ${err.message}` }, { status: 500 });
  }
}
