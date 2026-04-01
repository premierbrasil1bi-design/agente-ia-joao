import { CHANNEL_CONNECTION_STATE } from '../constants/channelConnectionStates.js';
import { normalizeChannelStatus } from './normalizeChannelStatus.js';

export function mapChannelToConnectionState({ status, loading = false, timeout = false, error = null } = {}) {
  if (error) return CHANNEL_CONNECTION_STATE.ERROR;
  if (timeout) return CHANNEL_CONNECTION_STATE.TIMEOUT;
  if (loading) return CHANNEL_CONNECTION_STATE.GENERATING_QR;
  const normalized = normalizeChannelStatus(status);
  if (normalized === 'CONNECTED') return CHANNEL_CONNECTION_STATE.CONNECTED;
  if (normalized === 'PENDING') return CHANNEL_CONNECTION_STATE.WAITING_SCAN;
  return CHANNEL_CONNECTION_STATE.IDLE;
}

