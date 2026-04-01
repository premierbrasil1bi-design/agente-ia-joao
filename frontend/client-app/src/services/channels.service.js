import { agentApi } from './agentApi.js';

export const channelsService = {
  listAgentChannels() {
    return agentApi.request('/api/agent/channels');
  },

  /** Instâncias Evolution via backend (nunca chamar domínio Evolution direto no browser). */
  listEvolutionInstances() {
    return agentApi.request('/api/evolution/instances');
  },

  createChannel(payload) {
    return agentApi.request('/api/channels', {
      method: 'POST',
      body: payload,
    });
  },

  updateChannel(channelId, payload) {
    return agentApi.request(`/api/channels/${channelId}`, {
      method: 'PUT',
      body: payload,
    });
  },

  deleteChannel(channelId) {
    return agentApi.request(`/api/channels/${channelId}`, {
      method: 'DELETE',
    });
  },

  connectChannel(channelId) {
    return agentApi.request(`/api/channels/${channelId}/provision-instance`, {
      method: 'POST',
    });
  },

  provisionInstance(channelId) {
    return agentApi.request(`/api/channels/${channelId}/provision-instance`, {
      method: 'POST',
    });
  },

  getConnectionArtifact(channelId) {
    return agentApi.request(`/api/channels/${channelId}/connection-artifact`, {
      method: 'GET',
    });
  },

  getQrCode(channelId) {
    return agentApi.request(`/api/channels/${channelId}/qrcode`, {
      method: 'GET',
    });
  },

  getStatus(channelId) {
    return agentApi.request(`/api/channels/${channelId}/status`, {
      method: 'GET',
    });
  },

  /** Envio manual (teste) — provider evolution ou waha */
  sendChannelMessage(channelId, payload) {
    return agentApi.request(`/api/channels/${channelId}/send`, {
      method: 'POST',
      body: payload,
    });
  },
};
