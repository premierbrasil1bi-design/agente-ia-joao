/**
 * Cliente API – envia canal ativo e JWT em todas as requisições.
 * Query: ?channel=X  |  Header: x-channel  |  Fallback: web
 * Em 401: chama onUnauthorized (ex.: logout + redirect /login) e lança erro.
 * Não envia requisição protegida se o token estiver ausente ou expirado (evita 401).
 */

import { getApiBaseUrl } from '../config/env.js';

const getBaseUrl = getApiBaseUrl;

/** Retorna true se o JWT estiver expirado (lê payload sem verificar assinatura). */
function isTokenExpired(token) {
  if (!token || typeof token !== 'string') return true;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return true;
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(b64));
    if (payload.exp == null) return false;
    return payload.exp * 1000 <= Date.now();
  } catch {
    return true;
  }
}

/**
 * @param {() => string} getChannel - canal ativo (web, api, whatsapp, instagram)
 * @param {() => string | null} [getToken] - token JWT do admin (para rotas protegidas)
 * @param {() => void} [onUnauthorized] - chamado quando a API retorna 401 (redirecionar para /login)
 */
export function createApiClient(getChannel, getToken = null, onUnauthorized = null) {
  const channel = () => (typeof getChannel === 'function' ? getChannel() : getChannel) || 'web';
  const token = () => (typeof getToken === 'function' ? getToken() : getToken) || null;

  const isProtectedPath = (path) => /^\/api\/(dashboard|agents)/.test(path);

  function ensureAuth(path) {
    const t = token();
    if (isProtectedPath(path) && (!t || isTokenExpired(t))) {
      if (onUnauthorized) onUnauthorized();
      throw new Error('Sessão inválida ou expirada. Faça login novamente.');
    }
  }

  function buildHeaders(options = {}) {
    const ch = channel();
    const headers = {
      'Content-Type': 'application/json',
      'x-channel': ch,
      ...options.headers,
    };
    const t = token();
    if (t) headers.Authorization = `Bearer ${t}`;
    return headers;
  }

  function handleResponse(res, data) {
    if (res.status === 401) {
      if (onUnauthorized) onUnauthorized();
      throw new Error(data.error || data.message || 'Sessão inválida. Faça login novamente.');
    }
    if (!res.ok) {
      throw new Error(data.error || data.message || `Erro ${res.status}`);
    }
  }

  async function request(path, options = {}) {
    ensureAuth(path);
    const url = `${getBaseUrl()}${path}`;
    const ch = channel();
    const urlObj = new URL(url, window.location.origin);
    urlObj.searchParams.set('channel', ch);
    const headers = buildHeaders(options);

    console.log(`[API] Canal: ${ch.toUpperCase()} | Endpoint: ${path}`);
    const res = await fetch(urlObj.toString(), { ...options, headers });
    const data = await res.json().catch(() => ({}));
    handleResponse(res, data);
    return data;
  }

  async function requestWithHeaders(path, options = {}) {
    ensureAuth(path);
    const url = `${getBaseUrl()}${path}`;
    const ch = channel();
    const urlObj = new URL(url, window.location.origin);
    urlObj.searchParams.set('channel', ch);
    const headers = buildHeaders(options);

    console.log(`[API] Canal: ${ch.toUpperCase()} | Endpoint: ${path}`);
    const res = await fetch(urlObj.toString(), { ...options, headers });
    const data = await res.json().catch(() => ({}));
    const xChannelActive = res.headers.get('x-channel-active') || res.headers.get('X-Channel-Active') || '';
    handleResponse(res, data);
    return { data, headers: { 'x-channel-active': xChannelActive } };
  }

  return {
    getContext: (clientId, agentId) =>
      requestWithHeaders(
        `/api/context?client_id=${clientId || ''}&agent_id=${agentId || ''}`
      ).then(({ data, headers }) => ({ ...data, _headerXChannelActive: headers['x-channel-active'] })),
    getSummary: () => request('/api/dashboard/summary'),
    getAgents: (clientId) =>
      request(`/api/dashboard/agents${clientId ? `?client_id=${clientId}` : ''}`),
    getChannels: (agentId) =>
      request(`/api/dashboard/channels${agentId ? `?agent_id=${agentId}` : ''}`),
    getCosts: (params) => {
      const q = new URLSearchParams(params).toString();
      return request(`/api/dashboard/costs${q ? `?${q}` : ''}`);
    },
    getMessages: (agentId, channelId, limit = 100, offset = 0) => {
      const q = new URLSearchParams({ agent_id: agentId, limit, offset });
      if (channelId) q.set('channel_id', channelId);
      return request(`/api/dashboard/messages?${q}`);
    },
    getPrompts: () => request(`/api/dashboard/prompts?agent_id=${AGENT_ID}`),
    getClients: () => request(`/api/dashboard/clients?agent_id=${AGENT_ID}`),
    import { AGENT_ID } from '../config/agent.js';
    listAgents: (clientId) =>
      request(`/api/agents${clientId ? `?client_id=${clientId}` : ''}`),
    createAgent: (body) =>
      request('/api/agents', { method: 'POST', body: JSON.stringify(body) }),
    updateAgent: (id, body) =>
      request(`/api/agents/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    deleteAgent: (id) =>
      request(`/api/agents/${id}`, { method: 'DELETE' }),
  };
}
