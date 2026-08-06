import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '../../lib/supabase-server';

// GET /api/rooms — List all rooms, optionally filtered by category or program
export async function GET(request) {
  const supabase = createServerSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const category = searchParams.get('category');
  const program = searchParams.get('program');

  let query = supabase.from('rooms').select('*').order('room_no');
  if (category) query = query.eq('category', category);
  if (program) query = query.eq('program', program);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// POST /api/rooms — Add a new room (Supabase only)
export async function POST(request) {
  const supabase = createServerSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Database not configured. Cannot add rooms in offline mode.' }, { status: 503 });
  }

  const body = await request.json();
  const { room_no, room_name, category, program, capacity } = body;

  if (!room_no || !category) {
    return NextResponse.json({ error: 'room_no and category are required' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('rooms')
    .insert({ room_no, room_name: room_name || `Room ${room_no}`, category, program: program || null, capacity: capacity || 0 })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

// DELETE /api/rooms?id=... — Delete a room (Supabase only)
export async function DELETE(request) {
  const supabase = createServerSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id parameter required' }, { status: 400 });

  const { error } = await supabase.from('rooms').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

// PATCH /api/rooms — Update a room (Supabase only)
export async function PATCH(request) {
  const supabase = createServerSupabaseClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const body = await request.json();
  const { id, ...updates } = body;
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const { data, error } = await supabase
    .from('rooms')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
