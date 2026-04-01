export function normalizeChannelStatus(status) {
  if (!status) return 'UNKNOWN';
  const s = String(status).toLowerCase();
  if (['connected', 'online', 'open'].includes(s)) return 'CONNECTED';
  if (['connecting', 'pending', 'qr', 'created', 'awaiting_connection'].includes(s)) return 'PENDING';
  if (['disconnected', 'closed', 'close', 'inactive', 'offline', 'error'].includes(s)) return 'DISCONNECTED';
  return 'UNKNOWN';
}

