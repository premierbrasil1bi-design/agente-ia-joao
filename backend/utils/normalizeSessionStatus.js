/**
 * Status canônico de sessão WhatsApp (multi-provider).
 * Fonte única para UI em tempo real + monitor.
 */

export const SESSION_CANONICAL = {
  CONNECTING: 'CONNECTING',
  QR_READY: 'QR_READY',
  CONNECTED: 'CONNECTED',
  DISCONNECTED: 'DISCONNECTED',
  FAILED: 'FAILED',
};

/**
 * Normaliza estado bruto (adapter WORKING/QR/OFFLINE ou strings Evolution/WAHA) para enum canônico.
 * @param {string} [provider]
 * @param {unknown} rawStatus
 * @returns {keyof typeof SESSION_CANONICAL extends infer K ? (typeof SESSION_CANONICAL)[K] : string}
 */
export function normalizeSessionStatus(provider, rawStatus) {
  const s = String(rawStatus ?? '').trim().toUpperCase();

  if (s === 'WORKING') return SESSION_CANONICAL.CONNECTED;
  if (s === 'QR') return SESSION_CANONICAL.QR_READY;
  if (s === 'FAILED' || s === 'ERROR') return SESSION_CANONICAL.FAILED;
  if (s === 'OFFLINE' || s === 'STOPPED' || s === 'CLOSED') return SESSION_CANONICAL.DISCONNECTED;

  const l = String(rawStatus ?? '').trim().toLowerCase();
  if (['open', 'connected', 'online', 'working'].includes(l)) return SESSION_CANONICAL.CONNECTED;
  if (['scan_qr_code', 'qr', 'qrcode'].includes(l)) return SESSION_CANONICAL.QR_READY;
  if (['starting', 'connecting', 'pending', 'close'].includes(l)) return SESSION_CANONICAL.CONNECTING;
  if (l.includes('fail') || l === 'refused') return SESSION_CANONICAL.FAILED;
  if (!l || l === 'undefined' || l === 'disconnected') return SESSION_CANONICAL.DISCONNECTED;

  void provider;
  return SESSION_CANONICAL.DISCONNECTED;
}
