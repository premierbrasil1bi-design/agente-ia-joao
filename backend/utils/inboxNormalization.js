export function normalizeChannelType(channel) {
  const raw = typeof channel === 'string' ? channel : channel?.type || channel?.channel_type || '';
  const s = String(raw || '').toLowerCase().trim();
  if (['whatsapp', 'waha', 'evolution', 'zapi', 'official', 'whatsapp_oficial'].includes(s)) return 'whatsapp';
  if (['web', 'webchat', 'chatweb', 'widget'].includes(s)) return 'webchat';
  if (['telegram', 'tg'].includes(s)) return 'telegram';
  if (['instagram', 'ig'].includes(s)) return 'instagram';
  return 'unknown';
}

export function normalizeMessageStatus(status) {
  const s = String(status || '').toUpperCase().trim();
  if (['PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED'].includes(s)) return s;
  if (s === 'ERROR') return 'FAILED';
  return 'SENT';
}

export function buildConversationId(channelId, participantId) {
  return `${String(channelId || '')}:${String(participantId || '')}`;
}

