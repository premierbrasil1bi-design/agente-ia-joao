/**
 * Channels API – CRUD for client app (app.omnia1biai.com.br).
 * Todas as requisições passam por agentApi.request() com Authorization: Bearer <token>.
 */

import { agentApi } from '../services/agentApi.js';

/**
 * @param {() => string | null} getToken - mantido por compatibilidade; token vem de agentApi
 * @param {() => void} [onUnauthorized] - mantido por compatibilidade; 401 tratado em agentApi
 */
export function createChannelsApi(getToken, onUnauthorized = null) {
  async function request(path, options = {}) {
    return agentApi.request(path, options);
  }

  return {
    getChannels: () => request('/api/agent/channels'),
    getEvolutionInstances: () => request('/api/agent/channels/evolution-instances'),
    getChannel: (id) => request(`/api/agent/channels/${id}`),
    createChannel: (data) =>
      request('/api/agent/channels', { method: 'POST', body: JSON.stringify(data) }),
    updateChannel: (id, data) =>
      request(`/api/agent/channels/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteChannel: (id) => request(`/api/agent/channels/${id}`, { method: 'DELETE' }),
  };
}
