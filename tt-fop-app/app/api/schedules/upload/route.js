import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '../../../lib/supabase-server';

const PARSER_SERVICE_URL = process.env.PARSER_SERVICE_URL || 'http://localhost:8000';

/**
 * POST /api/schedules/upload
 * Handles file upload, saves raw file to Supabase Storage ('timetables'),
 * sends the file to the Python parser microservice for extraction,
 * and inserts parsed entries to DB.
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

    // 1. Upload raw file to Supabase Storage bucket 'timetables'
    const { data: storageData, error: storageError } = await supabase.storage
      .from('timetables')
      .upload(storagePath, buffer, { contentType: file.type || 'application/octet-stream', upsert: true });

    if (storageError) {
      console.error('Supabase Storage error:', storageError);
      return NextResponse.json({ error: `Storage upload failed: ${storageError.message}` }, { status: 500 });
    }

    // 2. Delete any existing upload for this program/semester/division combo
    //    (upsert with onConflict doesn't work when division is NULL because SQL treats NULL != NULL)
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
      for (const existing of existingUploads) {
        // Delete old entries (cascade from timetable_uploads → timetable_entries)
        await supabase.from('timetable_uploads').delete().eq('id', existing.id);
        // Clean up old storage file
        if (existing.file_path) {
          await supabase.storage.from('timetables').remove([existing.file_path]);
        }
      }
    }

    // Insert fresh upload record
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

    // 3. Send the file to the Python parser microservice for extraction
    const parserForm = new FormData();
    parserForm.append('file', new Blob([buffer]), originalFilename);
    parserForm.append('program', program);
    parserForm.append('semester', String(semester));
    if (division) parserForm.append('division', division);

    let entries = [];
    let parserUsed = 'unknown';

    try {
      const parserResponse = await fetch(`${PARSER_SERVICE_URL}/parse-timetable`, {
        method: 'POST',
        body: parserForm,
      });

      if (parserResponse.ok) {
        const parserResult = await parserResponse.json();
        entries = parserResult.entries || [];
        parserUsed = parserResult.parser || 'unknown';
      } else {
        const errorBody = await parserResponse.text();
        console.error(`[upload] Parser service returned ${parserResponse.status}: ${errorBody}`);
      }
    } catch (parserErr) {
      console.error('[upload] Parser service unreachable:', parserErr.message);
      return NextResponse.json({
        error: `Parser service is unreachable at ${PARSER_SERVICE_URL}. Ensure the Python parser service is running.`
      }, { status: 503 });
    }

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
        room: e.room || null
      }));

      // Delete any previous entries for this upload record before inserting
      await supabase.from('timetable_entries').delete().eq('upload_id', uploadRecord.id);

      const { error: insertError } = await supabase.from('timetable_entries').insert(entriesWithUploadId);

      if (insertError) {
        console.error('Error inserting entries to Supabase:', insertError);
        await supabase.from('timetable_uploads').update({ status: 'failed' }).eq('id', uploadRecord.id);
        return NextResponse.json({ error: `Failed to insert slots: ${insertError.message}` }, { status: 500 });
      }

      // Mark upload record as parsed in Supabase
      await supabase.from('timetable_uploads').update({ status: 'parsed' }).eq('id', uploadRecord.id);

      return NextResponse.json({
        success: true,
        message: `Successfully uploaded & parsed ${entries.length} slots into Supabase (parser: ${parserUsed}).`,
        id: uploadRecord.id,
        slotsCount: entries.length
      });
    } else {
      await supabase.from('timetable_uploads').update({ status: 'failed' }).eq('id', uploadRecord.id);
      return NextResponse.json({
        error: 'File uploaded to storage but no valid timetable entries could be extracted.'
      }, { status: 400 });
    }

  } catch (err) {
    console.error('Server upload error:', err);
    return NextResponse.json({ error: `Internal server error: ${err.message}` }, { status: 500 });
  }
}
