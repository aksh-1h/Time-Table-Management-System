'use client';
import Sidebar from '../components/Sidebar';
import { useAuth } from '../context/AuthContext';

export default function AuthLayout({ children }) {
  const { user, loading } = useAuth();

  // Show loading state
  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--paper)',
      }}>
        <div className="pulse" style={{ color: 'var(--slate)', fontSize: '14px' }}>Loading…</div>
      </div>
    );
  }

  // If not logged in, show nothing (AuthContext will redirect)
  if (!user) {
    return null;
  }

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="main-content">
        {children}
      </main>
    </div>
  );
}
