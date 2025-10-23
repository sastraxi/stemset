import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

// Use environment variable for API URL in production, fallback to root for local dev
const API_BASE = import.meta.env.VITE_API_URL || '';

interface User {
  id: string;
  name: string;
  email: string;
  picture?: string;
}

interface AuthStatus {
  authenticated: boolean;
  user?: User;
}

interface AuthContextValue {
  authStatus: AuthStatus | null;
  loading: boolean;
  login: () => void;
  logout: () => void;
  checkAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const checkAuth = async () => {
    try {
      const response = await fetch(`${API_BASE}/auth/status`, {
        credentials: 'include', // Include cookies
      });
      const status: AuthStatus = await response.json();
      setAuthStatus(status);
    } catch (error) {
      console.error('Failed to check auth status:', error);
      setAuthStatus({ authenticated: false });
    } finally {
      setLoading(false);
    }
  };

  const login = () => {
    // Redirect to Google OAuth login
    window.location.href = `${API_BASE}/auth/login`;
  };

  const logout = async () => {
    try {
      await fetch(`${API_BASE}/auth/logout`, {
        credentials: 'include',
      });
      setAuthStatus({ authenticated: false });
    } catch (error) {
      console.error('Failed to logout:', error);
    }
  };

  useEffect(() => {
    checkAuth();
  }, []);

  return (
    <AuthContext.Provider value={{ authStatus, loading, login, logout, checkAuth }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
