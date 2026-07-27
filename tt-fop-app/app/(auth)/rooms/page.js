'use client';
import { useState, useEffect, useCallback } from 'react';

const categories = [
  'classroom',
  'pharmaceutics_lab',
  'pharm_chemistry_lab',
  'pharmacology_lab',
  'pharmacognosy_lab',
  'pharmacy_practice_lab',
  'phytopharmacy_lab',
  'quality_assurance_lab',
  'regulatory_affairs_lab',
  'pharma_analysis_lab',
  'pharma_technology_lab',
];

const programs = ['B.Pharm', 'M.Pharm', 'Pharm D', 'D.Pharm'];

export default function RoomsPage() {
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [filterCat, setFilterCat] = useState('');
  const [search, setSearch] = useState('');
  const [formData, setFormData] = useState({
    room_no: '',
    room_name: '',
    category: 'classroom',
    program: '',
    capacity: '',
  });
  const [saving, setSaving] = useState(false);

  const fetchRooms = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filterCat) params.set('category', filterCat);
      const res = await fetch(`/api/rooms?${params}`);
      if (!res.ok) throw new Error('Failed to fetch rooms');
      const data = await res.json();
      setRooms(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [filterCat]);

  useEffect(() => {
    fetchRooms();
  }, [fetchRooms]);

  const filtered = rooms.filter(r => {
    if (search && !r.room_no.toLowerCase().includes(search.toLowerCase()) &&
        !r.room_name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const handleAdd = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room_no: formData.room_no,
          room_name: formData.room_name || `Room ${formData.room_no}`,
          category: formData.category,
          program: formData.program || null,
          capacity: Number(formData.capacity) || 0,
        }),
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to add room');
      }
      setShowModal(false);
      setFormData({ room_no: '', room_name: '', category: 'classroom', program: '', capacity: '' });
      fetchRooms();
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this room?')) return;
    try {
      const res = await fetch(`/api/rooms?id=${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete room');
      fetchRooms();
    } catch (err) {
      alert(err.message);
    }
  };

  const formatCategory = (cat) => cat.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  const getCategoryBadgeClass = (cat) => {
    if (cat === 'classroom') return 'badge-general';
    if (cat.includes('lab') || cat === 'machine_room' || cat === 'instrumentation_lab') return 'badge-lab';
    return 'badge-partial';
  };

  return (
    <>
      <div className="page-header">
        <div className="page-header-left">
          <h1>Rooms</h1>
          <p>Manage the room pool available for assignment — {rooms.length} rooms loaded from database</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add room
        </button>
      </div>

      <div className="page-body">
        <div className="filters-bar">
          <input className="search-input" placeholder="Search by room number or name…" value={search} onChange={e => setSearch(e.target.value)} />
          <select className="filter-select" value={filterCat} onChange={e => setFilterCat(e.target.value)}>
            <option value="">All categories</option>
            {categories.map(c => <option key={c} value={c}>{formatCategory(c)}</option>)}
          </select>
          <div style={{ marginLeft: 'auto', fontSize: '13px', color: 'var(--slate)' }}>
            {filtered.length} room{filtered.length !== 1 ? 's' : ''}
          </div>
        </div>

        {error && (
          <div className="alert alert-error" style={{ marginBottom: '16px' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <span>{error} — showing cached data if available</span>
          </div>
        )}

        {loading ? (
          <div className="card" style={{ textAlign: 'center', padding: '48px' }}>
            <div className="pulse" style={{ marginBottom: '16px' }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--signal-blue)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>
              </svg>
            </div>
            <div className="headline-md">Loading rooms from database…</div>
          </div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Room No</th>
                  <th>Room Name</th>
                  <th>Category</th>
                  <th>Program</th>
                  <th>Capacity</th>
                  <th style={{ width: '80px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      <div className="empty-state">
                        <div className="empty-state-title">No rooms found</div>
                        <p>No rooms match your filters. Try adjusting the search or category filter.</p>
                      </div>
                    </td>
                  </tr>
                ) : filtered.map(r => (
                  <tr key={r.id}>
                    <td><span className="mono" style={{ fontWeight: 500 }}>{r.room_no}</span></td>
                    <td style={{ fontSize: '13px' }}>{r.room_name}</td>
                    <td>
                      <span className={`badge ${getCategoryBadgeClass(r.category)}`}>
                        {formatCategory(r.category)}
                      </span>
                    </td>
                    <td style={{ fontSize: '13px', color: r.program ? 'var(--ink)' : 'var(--slate)' }}>
                      {r.program || '—'}
                    </td>
                    <td className="mono">{r.capacity}</td>
                    <td>
                      <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(r.id)} title="Delete room">
                        <svg width="14" height="14" viewBox="0 0 24 24" stroke="var(--conflict-red)" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Room Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Add room</h2>
              <button className="btn btn-ghost" onClick={() => setShowModal(false)}>
                <svg width="18" height="18" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <form onSubmit={handleAdd}>
              <div className="form-group">
                <label className="form-label" htmlFor="room-no">Room No</label>
                <input id="room-no" className="form-input" placeholder='e.g. "303"' required value={formData.room_no} onChange={e => setFormData({ ...formData, room_no: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="room-name">Room Name</label>
                <input id="room-name" className="form-input" placeholder='e.g. "Class Room - B.Pharm - 1"' value={formData.room_name} onChange={e => setFormData({ ...formData, room_name: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="room-cat">Category</label>
                <select id="room-cat" className="form-select" value={formData.category} onChange={e => setFormData({ ...formData, category: e.target.value })}>
                  {categories.map(c => <option key={c} value={c}>{formatCategory(c)}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="room-prog">Program</label>
                <select id="room-prog" className="form-select" value={formData.program} onChange={e => setFormData({ ...formData, program: e.target.value })}>
                  <option value="">Shared / Any</option>
                  {programs.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="room-cap">Capacity</label>
                <input id="room-cap" className="form-input" type="number" min="1" placeholder="e.g. 30" value={formData.capacity} onChange={e => setFormData({ ...formData, capacity: e.target.value })} />
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Adding…' : 'Add room'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
