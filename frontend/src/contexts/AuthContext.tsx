import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

// Use environment variable for API URL in production, fallback to root for local dev
const API_BASE = import.meta.env.VITE_API_URL || '';

const TOKEN_KEY = 'stemset_token';

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
  getToken: () => string | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const getToken = () => {
    return localStorage.getItem(TOKEN_KEY);
  };

  const setToken = (token: string) => {
    localStorage.setItem(TOKEN_KEY, token);
  };

  const clearToken = () => {
    localStorage.removeItem(TOKEN_KEY);
  };

  const checkAuth = async () => {
    const token = getToken();
    if (!token) {
      setAuthStatus({ authenticated: false });
      setLoading(false);
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/auth/status`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const status: AuthStatus = await response.json();
      setAuthStatus(status);

      // If token is invalid, clear it
      if (!status.authenticated) {
        clearToken();
      }
    } catch (error) {
      console.error('Failed to check auth status:', error);
      setAuthStatus({ authenticated: false });
      clearToken();
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
      const token = getToken();
      if (token) {
        await fetch(`${API_BASE}/auth/logout`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
      }
      clearToken();
      setAuthStatus({ authenticated: false });
      // Navigate to home page after logout
      window.location.href = '/';
    } catch (error) {
      console.error('Failed to logout:', error);
      clearToken();
      setAuthStatus({ authenticated: false });
    }
  };

  // Handle OAuth callback with token in URL fragment
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.startsWith('#token=')) {
      const token = hash.substring(7); // Remove '#token='
      setToken(token);
      // Clean up URL
      window.history.replaceState(null, '', window.location.pathname);
      // Check auth with new token
      checkAuth();
    } else {
      checkAuth();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AuthContext.Provider value={{ authStatus, loading, login, logout, checkAuth, getToken }}>
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
