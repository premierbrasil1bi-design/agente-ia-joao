/**
 * Núcleo de estados de canal (substitui @omnia/channel-core no client-app).
 * Alinhado a packages/channel-core para comportamento estável.
 */

export const CHANNEL_CONNECTION_STATE = {
  IDLE: 'IDLE',
  GENERATING_QR: 'GENERATING_QR',
  WAITING_SCAN: 'WAITING_SCAN',
  CONNECTED: 'CONNECTED',
  TIMEOUT: 'TIMEOUT',
  ERROR: 'ERROR',
};

export function normalizeChannelStatus(status) {
  if (!status) return 'UNKNOWN';
  const u = String(status).trim().toUpperCase();
  if (u === 'CONNECTED' || u === 'PENDING' || u === 'DISCONNECTED' || u === 'ERROR') return u;
  if (u === 'QR_READY' || u === 'CONNECTING') return 'PENDING';
  if (u === 'FAILED') return 'ERROR';
  const s = String(status).trim().toLowerCase();
  if (['connected', 'online', 'open', 'working'].includes(s)) return 'CONNECTED';
  if (['connecting', 'pending', 'qr', 'qrcode', 'qr_ready', 'created', 'awaiting_connection', 'starting'].includes(s)) {
    return 'PENDING';
  }
  if (['failed'].includes(s)) return 'ERROR';
  if (['disconnected', 'closed', 'close', 'inactive', 'offline', 'unstable', 'unavailable'].includes(s)) {
    return 'DISCONNECTED';
  }
  if (['error'].includes(s)) return 'ERROR';
  return 'UNKNOWN';
}

export function mapChannelToConnectionState({ status, loading = false, timeout = false, error = null } = {}) {
  if (error || normalizeChannelStatus(status) === 'ERROR') return CHANNEL_CONNECTION_STATE.ERROR;
  if (timeout) return CHANNEL_CONNECTION_STATE.TIMEOUT;
  if (loading) return CHANNEL_CONNECTION_STATE.GENERATING_QR;
  const normalized = normalizeChannelStatus(status);
  if (normalized === 'CONNECTED') return CHANNEL_CONNECTION_STATE.CONNECTED;
  if (normalized === 'PENDING') return CHANNEL_CONNECTION_STATE.WAITING_SCAN;
  return CHANNEL_CONNECTION_STATE.IDLE;
}

export function normalizeChannelType(channel) {
  const raw =
    typeof channel === 'string' ? channel : channel?.type || channel?.channelType || channel?.channel_type || '';
  const s = String(raw || '').toLowerCase().trim();
  if (['whatsapp', 'waha', 'evolution', 'zapi', 'official', 'whatsapp_oficial'].includes(s)) return 'whatsapp';
  if (['webchat', 'web', 'chatweb', 'widget'].includes(s)) return 'webchat';
  if (['telegram', 'tg'].includes(s)) return 'telegram';
  if (['instagram', 'ig'].includes(s)) return 'instagram';
  return 'unknown';
}
