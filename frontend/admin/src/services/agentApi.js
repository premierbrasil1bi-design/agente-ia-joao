/**
 * API cliente Client App (OMNIA AI).
 * Token em localStorage.getItem('token'); todas as requisições protegidas enviam Authorization: Bearer <token>.
 * Em 401 ou sem token: limpa token e redireciona para /login.
 */

import { getApiBaseUrl } from '../config/env.js';

const BASE = getApiBaseUrl;

const TOKEN_KEY = 'token';
const AGENT_USER = 'agent_user';

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function clearAndRedirectLogin() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(AGENT_USER);
  const base = typeof window !== 'undefined' ? window.location.origin : '';
  if (typeof window !== 'undefined') window.location.href = `${base}/login`;
}

async function request(path, options = {}) {
  const token = getToken();
  if (!token) {
    clearAndRedirectLogin();
    throw new Error('Sessão expirada. Faça login novamente.');
  }
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    ...options.headers,
  };

  const url = `${BASE()}${path}`;
  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => ({}));

  if (res.status === 401) {
    clearAndRedirectLogin();
    throw new Error(data.error || 'Sessão inválida. Faça login novamente.');
  }
  if (!res.ok) {
    throw new Error(data.error || data.message || `Erro ${res.status}`);
  }
  return data;
}

export const agentApi = {
  getToken,
  getAgent() {
    try {
      const s = localStorage.getItem(AGENT_USER);
      return s ? JSON.parse(s) : null;
    } catch {
      return null;
    }
  },

  async login(email, password) {
    const url = `${BASE()}/api/agent/auth/login`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data.error || (res.status === 401 ? 'Email ou senha inválidos.' : `Erro ${res.status}`);
      throw new Error(msg);
    }
    return data;
  },

  async getSummary() {
    return request('/api/agent/dashboard/summary');
  },
};
