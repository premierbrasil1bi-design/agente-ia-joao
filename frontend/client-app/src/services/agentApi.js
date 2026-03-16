/**
 * API cliente AGENTE IA OMNICANAL – LocalStorage exclusivo: agent_token, agent_user.
 * Todas as requisições protegidas enviam Authorization: Bearer agent_token.
 * Em 401: limpa agent_token e agent_user e redireciona para /login.
 */

import { getApiBaseUrl } from '../config/env.js';

const BASE = getApiBaseUrl;

const AGENT_TOKEN = 'agent_token';
const AGENT_USER = 'agent_user';

function getToken() {
  return localStorage.getItem(AGENT_TOKEN);
}

function clearAndRedirectLogin() {
  localStorage.removeItem(AGENT_TOKEN);
  localStorage.removeItem(AGENT_USER);
  const base = typeof window !== 'undefined' ? window.location.origin : '';
  if (typeof window !== 'undefined') window.location.href = `${base}/login`;
}

async function request(path, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };
  if (token) headers.Authorization = `Bearer ${token}`;

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
