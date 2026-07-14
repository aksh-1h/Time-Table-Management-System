'use client';
import { createContext, useContext, useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';

const AuthContext = createContext(null);

// Predefined user accounts (superadmin-managed)
// In a real app, this would come from a database
const AUTHORIZED_USERS = [
  { email: 'admin@paruluniversity.ac.in', password: 'admin123', name: 'Admin User', role: 'superadmin' },
  { email: 'coordinator@paruluniversity.ac.in', password: 'coord123', name: 'FOP Coordinator', role: 'coordinator' },
  { email: 'hod@paruluniversity.ac.in', password: 'hod123', name: 'HOD Pharmacy', role: 'hod' },
  { email: 'faculty@paruluniversity.ac.in', password: 'faculty123', name: 'Faculty Member', role: 'faculty' },
];

const ALLOWED_DOMAIN = '@paruluniversity.ac.in';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // Check for stored session
    try {
      const stored = localStorage.getItem('tt_fop_user');
      if (stored) {
        setUser(JSON.parse(stored));
      }
    } catch (e) {
      // Ignore parse errors
    }
    setLoading(false);
  }, []);

  // Redirect logic
  useEffect(() => {
    if (loading) return;
    const isAuthPage = pathname === '/' || pathname === '/login';
    if (!user && !isAuthPage) {
      router.push('/');
    }
    if (user && isAuthPage) {
      router.push('/dashboard');
    }
  }, [user, loading, pathname, router]);

  const login = (email, password) => {
    // Validate domain
    if (!email.endsWith(ALLOWED_DOMAIN)) {
      return { success: false, error: `Only ${ALLOWED_DOMAIN} email addresses are allowed` };
    }

    // Find user
    const found = AUTHORIZED_USERS.find(
      u => u.email.toLowerCase() === email.toLowerCase() && u.password === password
    );

    if (!found) {
      return { success: false, error: 'Invalid credentials. Contact your superadmin for account access.' };
    }

    const userData = { email: found.email, name: found.name, role: found.role };
    setUser(userData);
    localStorage.setItem('tt_fop_user', JSON.stringify(userData));
    return { success: true };
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('tt_fop_user');
    router.push('/');
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, ALLOWED_DOMAIN }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
