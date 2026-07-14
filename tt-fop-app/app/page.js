'use client';
import { useState } from 'react';
import { useAuth } from './context/AuthContext';

export default function LoginPage() {
  const { login, user, loading, ALLOWED_DOMAIN } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Show nothing while checking auth
  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'var(--paper)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <div className="pulse" style={{ color: 'var(--slate)', fontSize: '14px' }}>Loading…</div>
      </div>
    );
  }

  // If already logged in, auth context will redirect
  if (user) return null;

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    // Small delay for UX
    await new Promise(r => setTimeout(r, 600));

    const result = login(email, password);
    if (!result.success) {
      setError(result.error);
      setIsSubmitting(false);
    }
    // If success, the auth context will redirect to /dashboard
  };

  const emailDomainValid = email === '' || email.includes('@') ? email.endsWith(ALLOWED_DOMAIN) || !email.includes('@') : true;

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0d1321 0%, #1a2744 40%, #1C2333 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Background pattern */}
      <div style={{
        position: 'absolute',
        inset: 0,
        backgroundImage: `radial-gradient(circle at 1px 1px, rgba(47,94,255,0.08) 1px, transparent 0)`,
        backgroundSize: '32px 32px',
        pointerEvents: 'none',
      }} />

      {/* Glow effect */}
      <div style={{
        position: 'absolute',
        top: '-20%',
        left: '50%',
        transform: 'translateX(-50%)',
        width: '600px',
        height: '600px',
        background: 'radial-gradient(circle, rgba(47,94,255,0.12) 0%, transparent 70%)',
        borderRadius: '50%',
        pointerEvents: 'none',
      }} />

      <div style={{
        background: 'rgba(255,255,255,0.97)',
        border: '1px solid rgba(196,197,217,0.4)',
        borderRadius: 'var(--radius-xl)',
        padding: '48px 40px',
        width: '100%',
        maxWidth: '420px',
        boxShadow: '0 24px 80px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.1) inset',
        position: 'relative',
        zIndex: 1,
        animation: 'slideUp 0.5s ease',
      }}>
        {/* Brand */}
        <div style={{ textAlign: 'center', marginBottom: '36px' }}>
          <div style={{
            width: '56px', height: '56px',
            background: 'linear-gradient(135deg, #2F5EFF, #1a3db8)',
            borderRadius: 'var(--radius-lg)',
            margin: '0 auto 18px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff',
            fontFamily: 'var(--font-headline)',
            fontWeight: 600, fontSize: '20px',
            boxShadow: '0 4px 16px rgba(47,94,255,0.3)',
          }}>FP</div>
          <div style={{
            fontFamily: 'var(--font-headline)',
            fontSize: '22px', fontWeight: 600,
            color: 'var(--ink)',
            letterSpacing: '-0.01em',
          }}>Scheduler Pro</div>
          <div style={{
            fontSize: '13px',
            color: 'var(--slate)',
            marginTop: '6px',
          }}>Parul University · Faculty of Pharmacy</div>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="alert alert-error" style={{ marginBottom: '20px', fontSize: '13px' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleLogin}>
          <div className="form-group">
            <label className="form-label" htmlFor="login-email">Email address</label>
            <input
              id="login-email"
              className="form-input"
              type="email"
              placeholder="yourname@paruluniversity.ac.in"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(''); }}
              required
              autoComplete="email"
              style={{
                borderColor: (!emailDomainValid && email.includes('@')) ? 'var(--conflict-red)' : undefined,
              }}
            />
            {!emailDomainValid && email.includes('@') && (
              <div style={{
                fontSize: '12px',
                color: 'var(--conflict-red)',
                marginTop: '6px',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                </svg>
                Only {ALLOWED_DOMAIN} addresses are allowed
              </div>
            )}
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="login-password">Password</label>
            <div style={{ position: 'relative' }}>
              <input
                id="login-password"
                className="form-input"
                type={showPassword ? 'text' : 'password'}
                placeholder="Enter your password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(''); }}
                required
                autoComplete="current-password"
                style={{ paddingRight: '40px' }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: 'absolute',
                  right: '8px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  color: 'var(--slate)',
                  cursor: 'pointer',
                  padding: '4px',
                  display: 'flex',
                  alignItems: 'center',
                }}
                tabIndex={-1}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={isSubmitting || (!emailDomainValid && email.includes('@'))}
            style={{
              width: '100%',
              justifyContent: 'center',
              marginTop: '12px',
              padding: '12px 16px',
              fontSize: '15px',
              fontWeight: 600,
              opacity: isSubmitting ? 0.7 : 1,
              transition: 'all 200ms ease',
            }}
          >
            {isSubmitting ? (
              <span className="pulse" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="2" x2="12" y2="6" /><line x1="12" y1="18" x2="12" y2="22" />
                  <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" /><line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
                  <line x1="2" y1="12" x2="6" y2="12" /><line x1="18" y1="12" x2="22" y2="12" />
                  <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" /><line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
                </svg>
                Signing in…
              </span>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><polyline points="10 17 15 12 10 7" /><line x1="15" y1="12" x2="3" y2="12" />
                </svg>
                Sign in
              </>
            )}
          </button>
        </form>

        {/* Info notice */}
        <div style={{
          marginTop: '24px',
          padding: '14px 16px',
          background: 'rgba(47,94,255,0.04)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid rgba(47,94,255,0.1)',
        }}>
          <div style={{
            fontSize: '12px',
            fontWeight: 600,
            color: 'var(--signal-blue)',
            marginBottom: '6px',
            letterSpacing: '0.03em',
            textTransform: 'uppercase',
          }}>Restricted access</div>
          <div style={{
            fontSize: '12px',
            color: 'var(--slate)',
            lineHeight: '1.5',
          }}>
            Sign-up is not available. Accounts are created by the superadmin only. Contact your HOD or system administrator for access.
          </div>
        </div>

        {/* Demo credentials */}
        <div style={{
          marginTop: '16px',
          padding: '14px 16px',
          background: 'var(--surface-container-low)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--outline-variant)',
        }}>
          <div style={{
            fontSize: '12px',
            fontWeight: 600,
            color: 'var(--ink)',
            marginBottom: '8px',
            letterSpacing: '0.03em',
            textTransform: 'uppercase',
          }}>Demo credentials</div>
          <div style={{ fontSize: '12px', color: 'var(--slate)', lineHeight: '1.8' }}>
            <div style={{ display: 'flex', gap: '8px' }}>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink)', fontWeight: 500 }}>admin@paruluniversity.ac.in</span>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <span>Password:</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink)', fontWeight: 500 }}>admin123</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
