'use client';
import Link from 'next/link';

const recentUploads = [
  { division: 'A', semester: 7, date: '2026-07-10', status: 'Assigned' },
  { division: 'B', semester: 7, date: '2026-07-10', status: 'Partial' },
  { division: 'A', semester: 5, date: '2026-07-09', status: 'Assigned' },
  { division: 'C', semester: 3, date: '2026-07-08', status: 'Conflicts' },
];

export default function DashboardPage() {
  return (
    <>
      <div className="page-header">
        <div className="page-header-left">
          <h1>Dashboard</h1>
          <p>Overview of timetable assignments for the current semester</p>
        </div>
        <Link href="/upload" className="btn btn-primary">
          <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          Upload timetable
        </Link>
      </div>

      <div className="page-body">
        {/* Stat Cards */}
        <div className="stat-grid">
          <div className="stat-card">
            <div className="stat-card-label">Divisions loaded</div>
            <div className="stat-card-value">4</div>
            <div className="stat-card-footer">Sem 3, 5, 7</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-label">Total slots</div>
            <div className="stat-card-value">186</div>
            <div className="stat-card-footer">Across all divisions</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-label">Assigned</div>
            <div className="stat-card-value success">172</div>
            <div className="stat-card-footer">92.5% complete</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-label">Unresolved conflicts</div>
            <div className="stat-card-value danger">3</div>
            <div className="stat-card-footer">Require manual attention</div>
          </div>
        </div>

        {/* Quick Actions */}
        <div style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
          <Link href="/assignment" className="btn btn-secondary">
            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            Run assignment
          </Link>
          <Link href="/rooms" className="btn btn-secondary">
            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
            Manage rooms
          </Link>
        </div>

        {/* Recent Uploads */}
        <div className="card">
          <div style={{ marginBottom: '16px' }}>
            <div className="headline-md">Recent uploads</div>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Division</th>
                <th>Semester</th>
                <th>Upload date</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {recentUploads.map((u, i) => (
                <tr key={i}>
                  <td style={{ fontWeight: 500 }}>Division {u.division}</td>
                  <td className="mono">Sem {u.semester}</td>
                  <td className="mono">{u.date}</td>
                  <td>
                    <span className={`badge ${
                      u.status === 'Assigned' ? 'badge-assigned' :
                      u.status === 'Conflicts' ? 'badge-conflict' :
                      'badge-partial'
                    }`}>
                      {u.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
