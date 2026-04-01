export function normalizeChannelType(channel) {
  const raw = typeof channel === 'string' ? channel : channel?.type || channel?.channelType || channel?.channel_type || '';
  const s = String(raw || '').toLowerCase().trim();
  if (['whatsapp', 'waha', 'evolution', 'zapi', 'official', 'whatsapp_oficial'].includes(s)) return 'whatsapp';
  if (['webchat', 'web', 'chatweb', 'widget'].includes(s)) return 'webchat';
  if (['telegram', 'tg'].includes(s)) return 'telegram';
  if (['instagram', 'ig'].includes(s)) return 'instagram';
  return 'unknown';
}

