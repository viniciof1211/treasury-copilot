import { createContext, useContext, ReactNode } from 'react';
import type { User } from '../types';

/** Internal app - no login required. Always provides a default user. */
const INTERNAL_USER: User = {
  id: 'internal',
  email: 'internal@company.local',
  full_name: 'Internal User',
  role: 'admin',
  is_active: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

interface AuthContextType {
  user: User;
  loading: false;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  return (
    <AuthContext.Provider value={{ user: INTERNAL_USER, loading: false }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
