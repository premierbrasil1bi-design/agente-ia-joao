import { agentApi } from './agentApi.js';

export const messagesService = {
  listConversations(channelId = null) {
    const qs = channelId ? `?channelId=${encodeURIComponent(channelId)}` : '';
    return agentApi.request(`/api/messages/conversations${qs}`);
  },
  listMessages({ channelId, participantId, contact, limit = 100, offset = 0 }) {
    const pid = participantId || contact;
    const qs = new URLSearchParams({
      channelId: String(channelId),
      participantId: String(pid),
      limit: String(limit),
      offset: String(offset),
    }).toString();
    return agentApi.request(`/api/messages?${qs}`);
  },
  sendMessage({ channelId, participantId, contact, message, channelType = 'unknown', conversationId = null }) {
    const pid = participantId || contact;
    return agentApi.request('/api/messages/send', {
      method: 'POST',
      body: { channelId, participantId: pid, message, channelType, conversationId },
    });
  },
  getMetrics({ from = null, to = null, channelId = null } = {}) {
    const params = new URLSearchParams();
    if (from) params.set('from', String(from));
    if (to) params.set('to', String(to));
    if (channelId) params.set('channelId', String(channelId));
    const qs = params.toString();
    return agentApi.request(`/api/messages/metrics${qs ? `?${qs}` : ''}`);
  },
  getAlerts(channelId = null) {
    const qs = channelId ? `?channelId=${encodeURIComponent(channelId)}` : '';
    return agentApi.request(`/api/messages/alerts${qs}`);
  },
};

