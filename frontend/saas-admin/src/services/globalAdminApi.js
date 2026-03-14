/**
 * API do Global Admin – login, getMe, stats, tenants.
 * Token em localStorage: platform_token / platform_user (compatível com AuthContext).
 */

const BASE = () => import.meta.env.VITE_API_BASE_URL || '';

import { getAuthToken } from "../api/http";

const USER_KEY = 'platform_user';
const TOKEN_KEY = 'platform_token';

async function request(path, options = {}) {
  const token = getAuthToken();
  const url = `${BASE()}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    for (const key of ["platform_token", "adminToken", "token", "accessToken"]) {
      localStorage.removeItem(key);
    }
    localStorage.removeItem(USER_KEY);
    window.location.href = '/login';
    throw new Error('Sessão expirada. Faça login novamente.');
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || data.message || `Erro ${res.status}`);
  }
  return res.json();
}

export const globalAdminApi = {
  getToken: getAuthToken,

  async login(email, password) {
    const url = `${BASE()}/api/global-admin/login`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Credenciais inválidas');
    return data;
  },

  async getMe() {
    return request('/api/global-admin/me');
  },

  async getStats() {
    return request('/api/global-admin/stats');
  },

  async getTenants() {
    return request('/api/global-admin/tenants');
  },

  logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },
};
