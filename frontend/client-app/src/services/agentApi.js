/**
 * API cliente AGENTE IA OMNICANAL – LocalStorage exclusivo: agent_token, agent_user.
 * Todas as requisições protegidas enviam Authorization: Bearer agent_token.
 * Em 401: limpa agent_token e agent_user e redireciona para /login.
 */

import { getApiBaseUrl } from '../config/env.js';

const BASE = getApiBaseUrl;

const AGENT_TOKEN = 'agent_token';
const AGENT_USER = 'agent_user';
const CHANNEL_STORAGE_KEY = 'channel';
const VALID_CHANNELS = ['web', 'api', 'whatsapp', 'instagram'];

function getToken() {
  return localStorage.getItem(AGENT_TOKEN);
}

function clearAndRedirectLogin() {
  localStorage.removeItem(AGENT_TOKEN);
  localStorage.removeItem(AGENT_USER);
  const base = typeof window !== 'undefined' ? window.location.origin : '';
  if (typeof window !== 'undefined') window.location.href = `${base}/login`;
}

function normalizeChannelHeader(value) {
  const v = value == null || value === '' ? 'web' : String(value).trim().toLowerCase();
  return VALID_CHANNELS.includes(v) ? v : 'web';
}

/** Canal sempre válido: prioridade localStorage, depois ?channel= na URL. */
function getActiveChannelForHeader() {
  if (typeof window === 'undefined') return 'web';
  try {
    const saved = localStorage.getItem(CHANNEL_STORAGE_KEY);
    if (saved != null && String(saved).trim() !== '') {
      return normalizeChannelHeader(saved);
    }
    const fromUrl = new URLSearchParams(window.location.search).get('channel');
    return normalizeChannelHeader(fromUrl);
  } catch {
    return 'web';
  }
}

async function request(path, options = {}) {
  const token = getToken();
  const explicit = options.headers && options.headers['x-channel'];
  const channelHeader = explicit != null && explicit !== ''
    ? normalizeChannelHeader(explicit)
    : getActiveChannelForHeader();

  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
    'x-channel': channelHeader,
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  let body = options.body;
  if (body && typeof body === 'object') {
    body = JSON.stringify(body);
  }

  const url = `${BASE()}${path}`;
  const res = await fetch(url, { ...options, headers, body });
  const data = await res.json().catch(() => ({}));

  if (res.status === 401) {
    clearAndRedirectLogin();
    throw new Error(data.error || 'Sessão inválida. Faça login novamente.');
  }
  if (!res.ok) {
    const err = new Error(data.error || data.message || `Erro ${res.status}`);
    if (data.code) err.code = data.code;
    if (data.reason != null) err.reason = data.reason;
    if (data.feature != null) err.feature = data.feature;
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

export const agentApi = {
  getToken,
  request,
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
      headers: {
        'Content-Type': 'application/json',
        'x-channel': getActiveChannelForHeader(),
      },
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
