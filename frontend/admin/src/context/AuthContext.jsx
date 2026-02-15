/**
 * Contexto de autenticação ADMIN.
 * Armazena token e dados do admin (localStorage). Expõe login, logout e token para o cliente API.
 */

import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'agente_admin_token';
const STORAGE_ADMIN = 'agente_admin_user';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem(STORAGE_KEY));
  const [admin, setAdmin] = useState(() => {
    try {
      const s = localStorage.getItem(STORAGE_ADMIN);
      return s ? JSON.parse(s) : null;
    } catch {
      return null;
    }
  });

  const login = useCallback((newToken, adminData) => {
    localStorage.setItem(STORAGE_KEY, newToken);
    localStorage.setItem(STORAGE_ADMIN, JSON.stringify(adminData || {}));
    setToken(newToken);
    setAdmin(adminData || null);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_ADMIN);
    setToken(null);
    setAdmin(null);
  }, []);

  useEffect(() => {
    if (token) {
      const stored = localStorage.getItem(STORAGE_ADMIN);
      if (stored) {
        try {
          setAdmin(JSON.parse(stored));
        } catch {}
      }
    }
  }, [token]);

  const getToken = useCallback(() => token || localStorage.getItem(STORAGE_KEY), [token]);

  const value = {
    token,
    admin,
    isAuthenticated: !!token,
    login,
    logout,
    getToken,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de AuthProvider');
  return ctx;
}
