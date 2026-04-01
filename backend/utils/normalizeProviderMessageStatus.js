export function normalizeProviderMessageStatus(provider, rawStatus) {
  const p = String(provider || '').toLowerCase().trim();
  const s = String(rawStatus || '').toLowerCase().trim();

  if (!s) return 'PENDING';

  if (['failed', 'error', 'undelivered', 'rejected'].includes(s)) return 'FAILED';
  if (['read', 'seen', 'viewed'].includes(s)) return 'READ';
  if (['delivered', 'delivery_ack', 'server_ack'].includes(s)) return 'DELIVERED';
  if (['sent', 'queued', 'accepted', 'submitted'].includes(s)) return 'SENT';
  if (['pending', 'processing', 'created'].includes(s)) return 'PENDING';

  if (p === 'waha') {
    if (['ack', 'ack_server', 'ack_device'].includes(s)) return 'DELIVERED';
    if (['ack_read', 'ack_played'].includes(s)) return 'READ';
  }

  if (p === 'evolution') {
    if (['status_sent', 'status_delivered'].includes(s)) return 'DELIVERED';
    if (['status_read'].includes(s)) return 'READ';
  }

  return 'SENT';
}

