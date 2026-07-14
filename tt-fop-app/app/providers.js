'use client';
import { AuthProvider } from './context/AuthContext';
import { UploadTrackerProvider } from './context/UploadTrackerContext';

export function Providers({ children }) {
  return (
    <AuthProvider>
      <UploadTrackerProvider>
        {children}
      </UploadTrackerProvider>
    </AuthProvider>
  );
}
