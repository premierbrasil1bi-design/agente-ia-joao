/**
 * Agents API – CRUD for client app (app.omnia1biai.com.br).
 * Todas as requisições passam por agentApi.request() com Authorization: Bearer <token>.
 */

import { agentApi } from '../services/agentApi.js';

/**
 * @param {() => string | null} getToken - mantido por compatibilidade; token vem de agentApi
 * @param {() => void} [onUnauthorized] - mantido por compatibilidade; 401 tratado em agentApi
 */
export function createAgentsApi(getToken, onUnauthorized = null) {
  async function request(path, options = {}) {
    return agentApi.request(path, options);
  }

  return {
    getAgents: () => request('/api/agents'),
    getAgent: (id) => request(`/api/agents/${id}`),
    createAgent: (data) =>
      request('/api/agents', { method: 'POST', body: JSON.stringify(data) }),
    updateAgent: (id, data) =>
      request(`/api/agents/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteAgent: (id) => request(`/api/agents/${id}`, { method: 'DELETE' }),
  };
}
