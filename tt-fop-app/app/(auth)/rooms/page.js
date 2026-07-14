'use client';
import { useState } from 'react';

const initialRooms = [
  { id: 1, room_no: '201', category: 'general', capacity: 60 },
  { id: 2, room_no: '202', category: 'general', capacity: 60 },
  { id: 3, room_no: '303', category: 'general', capacity: 30 },
  { id: 4, room_no: '401', category: 'pharmacy_practice_lab', capacity: 30 },
  { id: 5, room_no: '402', category: 'pharmacy_practice_lab', capacity: 15 },
  { id: 6, room_no: '501', category: 'instrumentation_lab', capacity: 30 },
  { id: 7, room_no: '502', category: 'machine_room', capacity: 20 },
];

const categories = ['general', 'pharmacy_practice_lab', 'instrumentation_lab', 'machine_room', 'computer_lab'];

export default function RoomsPage() {
  const [rooms, setRooms] = useState(initialRooms);
  const [showModal, setShowModal] = useState(false);
  const [filterCat, setFilterCat] = useState('');
  const [search, setSearch] = useState('');
  const [formData, setFormData] = useState({ room_no: '', category: 'general', capacity: '' });

  const filtered = rooms.filter(r => {
    if (filterCat && r.category !== filterCat) return false;
    if (search && !r.room_no.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const handleAdd = (e) => {
    e.preventDefault();
    setRooms([...rooms, { id: Date.now(), ...formData, capacity: Number(formData.capacity) }]);
    setShowModal(false);
    setFormData({ room_no: '', category: 'general', capacity: '' });
  };

  const handleDelete = (id) => {
    setRooms(rooms.filter(r => r.id !== id));
  };

  const formatCategory = (cat) => cat.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  return (
    <>
      <div className="page-header">
        <div className="page-header-left">
          <h1>Rooms</h1>
          <p>Manage the room pool available for assignment</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          <svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add room
        </button>
      </div>

      <div className="page-body">
        <div className="filters-bar">
          <input className="search-input" placeholder="Search by room number…" value={search} onChange={e => setSearch(e.target.value)} />
          <select className="filter-select" value={filterCat} onChange={e => setFilterCat(e.target.value)}>
            <option value="">All categories</option>
            {categories.map(c => <option key={c} value={c}>{formatCategory(c)}</option>)}
          </select>
          <div style={{ marginLeft: 'auto', fontSize: '13px', color: 'var(--slate)' }}>
            {filtered.length} room{filtered.length !== 1 ? 's' : ''}
          </div>
        </div>

        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Room No</th>
                <th>Category</th>
                <th>Capacity</th>
                <th style={{ width: '80px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={4}>
                    <div className="empty-state">
                      <div className="empty-state-title">No rooms found</div>
                      <p>No rooms added yet — add your first room to begin assigning classes.</p>
                    </div>
                  </td>
                </tr>
              ) : filtered.map(r => (
                <tr key={r.id}>
                  <td><span className="mono" style={{ fontWeight: 500 }}>{r.room_no}</span></td>
                  <td>
                    <span className={`badge ${r.category === 'general' ? 'badge-general' : 'badge-lab'}`}>
                      {formatCategory(r.category)}
                    </span>
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
                <label className="form-label" htmlFor="room-cat">Category</label>
                <select id="room-cat" className="form-select" value={formData.category} onChange={e => setFormData({ ...formData, category: e.target.value })}>
                  {categories.map(c => <option key={c} value={c}>{formatCategory(c)}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="room-cap">Capacity</label>
                <input id="room-cap" className="form-input" type="number" min="1" placeholder="e.g. 30" required value={formData.capacity} onChange={e => setFormData({ ...formData, capacity: e.target.value })} />
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Add room</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
