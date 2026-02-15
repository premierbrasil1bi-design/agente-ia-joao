/**
 * Cliente API do painel – comunicação com o backend.
 * Base URL configurável; fallback para dados simulados quando offline.
 */

const BASE_URL = window.BACKEND_URL || 'http://localhost:3000';

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || `Erro ${res.status}`);
  return data;
}

export const api = {
  getSummary: () => request('/api/dashboard/summary'),
  getAgents: (clientId) => request(`/api/dashboard/agents${clientId ? `?client_id=${clientId}` : ''}`),
  getChannels: (agentId) => request(`/api/dashboard/channels${agentId ? `?agent_id=${agentId}` : ''}`),
  getCosts: (params) => {
    const q = new URLSearchParams(params).toString();
    return request(`/api/dashboard/costs${q ? `?${q}` : ''}`);
  },
  getMessages: (agentId, channelId, limit = 100, offset = 0) => {
    const q = new URLSearchParams({ agent_id: agentId, limit, offset });
    if (channelId) q.set('channel_id', channelId);
    return request(`/api/dashboard/messages?${q}`);
  },
  getPrompts: (agentId) => request(`/api/dashboard/prompts?agent_id=${agentId}`),
  getClients: () => request('/api/dashboard/clients'),
};
