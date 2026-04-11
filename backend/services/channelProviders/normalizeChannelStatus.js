export function normalizeChannelStatus(provider, rawStatus) {
  const p = String(provider || '').toLowerCase().trim();
  const s = String(rawStatus ?? '')
    .trim()
    .toUpperCase()
    .replace(/-/g, '_');

  if (!s) return 'connecting';

  if (p === 'waha') {
    if (['CONNECTED', 'WORKING', 'OPEN'].includes(s)) return 'connected';
    if (['QR_AVAILABLE', 'SCAN_QR_CODE', 'STARTING', 'CONNECTING', 'PENDING'].includes(s)) return 'waiting';
    if (['FAILED', 'STOPPED', 'LOGGED_OUT', 'UNSTABLE', 'OFFLINE', 'ERROR', 'UNAVAILABLE'].includes(s)) {
      return 'error';
    }
    return 'connecting';
  }

  if (p === 'evolution') {
    if (['OPEN', 'CONNECTED'].includes(s)) return 'connected';
    if (['CONNECTING', 'QR', 'QRCODE', 'QRCODE_UPDATED', 'AWAITING_CONNECTION'].includes(s)) return 'waiting';
    if (['CLOSE', 'CLOSED', 'DISCONNECTED', 'FAILED', 'ERROR', 'OFFLINE'].includes(s)) return 'error';
    return 'connecting';
  }

  if (['CONNECTED', 'OPEN', 'WORKING'].includes(s)) return 'connected';
  if (['WAITING', 'PENDING', 'CONNECTING', 'QR_AVAILABLE', 'QR', 'QRCODE'].includes(s)) return 'waiting';
  if (['FAILED', 'ERROR', 'OFFLINE', 'STOPPED', 'DISCONNECTED'].includes(s)) return 'error';
  return 'connecting';
}
