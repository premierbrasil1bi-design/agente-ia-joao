/**
 * Channels API – CRUD for client app (app.omnia1biai.com.br).
 * All requests use JWT; backend scopes by tenantId from token.
 */

import { getApiBaseUrl } from '../config/env.js';

/**
 * @param {() => string | null} getToken
 * @param {() => void} [onUnauthorized]
 */
export function createChannelsApi(getToken, onUnauthorized = null) {
  const base = () => getApiBaseUrl?.() ?? import.meta.env?.VITE_API_URL ?? '';

  async function request(path, options = {}) {
    const token = typeof getToken === 'function' ? getToken() : getToken;
    const url = `${base().replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(url, { ...options, headers });
    const data = await res.json().catch(() => ({}));

    if (res.status === 401) {
      if (onUnauthorized) onUnauthorized();
      throw new Error(data.error || data.message || 'Sessão inválida. Faça login novamente.');
    }
    if (!res.ok) {
      throw new Error(data.error || data.message || `Erro ${res.status}`);
    }
    return data;
  }

  return {
    getChannels: () => request('/api/channels'),
    getChannel: (id) => request(`/api/channels/${id}`),
    createChannel: (data) =>
      request('/api/channels', { method: 'POST', body: JSON.stringify(data) }),
    updateChannel: (id, data) =>
      request(`/api/channels/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteChannel: (id) => request(`/api/channels/${id}`, { method: 'DELETE' }),
  };
}
