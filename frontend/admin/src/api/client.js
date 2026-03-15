/**
 * Cliente API – todas as requisições passam por agentApi (Authorization: Bearer <token>).
 * Adiciona canal ativo: query ?channel=X e header x-channel.
 */

import { agentApi } from '../services/agentApi.js';
import { AGENT_ID } from '../config/agent.js';

/**
 * @param {() => string} getChannel - canal ativo (web, api, whatsapp, instagram)
 * @param {() => string | null} [getToken] - mantido por compatibilidade; token vem de agentApi
 * @param {() => void} [onUnauthorized] - mantido por compatibilidade; 401 tratado em agentApi
 */
export function createApiClient(getChannel, getToken = null, onUnauthorized = null) {
  const channel = () => (typeof getChannel === 'function' ? getChannel() : getChannel) || 'web';

  function pathWithChannel(path) {
    const ch = channel();
    const sep = path.includes('?') ? '&' : '?';
    return `${path}${sep}channel=${encodeURIComponent(ch)}`;
  }

  function headersWithChannel(options = {}) {
    return {
      ...options.headers,
      'x-channel': channel(),
    };
  }

  async function request(path, options = {}) {
    const pathWithQuery = pathWithChannel(path);
    return agentApi.request(pathWithQuery, {
      ...options,
      headers: headersWithChannel(options),
    });
  }

  async function requestWithHeaders(path, options = {}) {
    const pathWithQuery = pathWithChannel(path);
    const { data, response } = await agentApi.requestWithResponse(pathWithQuery, {
      ...options,
      headers: headersWithChannel(options),
    });
    const xChannelActive = response.headers.get('x-channel-active') || response.headers.get('X-Channel-Active') || '';
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
