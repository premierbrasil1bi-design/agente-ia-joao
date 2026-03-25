/**
 * Ciclo de vida da conexão WhatsApp/Evolution (coluna channels.connection_status).
 * Mantém dual-write com channels.status (active | inactive) para compatibilidade.
 */

/** @typedef {'connecting'|'connected'|'disconnected'|'error'} ConnectionStatus */

/**
 * @param {unknown} raw — string de estado Evolution ou objeto com .state
 * @returns {ConnectionStatus}
 */
export function mapEvolutionRawToConnectionStatus(raw) {
  let s = raw;
  if (s != null && typeof s === 'object' && !Array.isArray(s) && 'state' in s) {
    s = /** @type {{ state?: unknown }} */ (s).state;
  }
  if (s == null || String(s).trim() === '') return 'disconnected';
  const t = String(s).trim().toLowerCase();
  if (t === 'open' || t === 'connected') return 'connected';
  if (t === 'connecting' || t === 'qr') return 'connecting';
  if (t === 'close' || t === 'disconnected') return 'disconnected';
  if (t.includes('fail') || t.includes('error') || t === 'refused') return 'error';
  return 'connecting';
}

/**
 * @param {unknown} raw
 * @returns {{ connection_status: ConnectionStatus, status: 'active'|'inactive' }}
 */
export function dualStatusFromEvolutionRaw(raw) {
  const connection_status = mapEvolutionRawToConnectionStatus(raw);
  const status = connection_status === 'connected' ? 'active' : 'inactive';
  return { connection_status, status };
}
