/**
 * Estados de sessão WhatsApp agnósticos de provider (camada interna).
 * Mapeamento WAHA → SessionState em normalizeProviderSessionStatus.
 */

export const SessionState = {
  UNKNOWN: 'UNKNOWN',
  NOT_FOUND: 'NOT_FOUND',
  CREATING: 'CREATING',
  CREATED: 'CREATED',
  STARTING: 'STARTING',
  CONNECTING: 'CONNECTING',
  /** QR ainda não disponível no WAHA; cliente pode continuar polling. */
  PENDING: 'PENDING',
  QR_AVAILABLE: 'QR_AVAILABLE',
  READY: 'READY',
  CONNECTED: 'CONNECTED',
  DISCONNECTED: 'DISCONNECTED',
  FAILED: 'FAILED',
  RATE_LIMITED: 'RATE_LIMITED',
  /** WAHA inacessível (health check). */
  OFFLINE: 'OFFLINE',
  /** Polling QR desta sessão foi substituído por outro. */
  CANCELLED: 'CANCELLED',
  /** WAHA não responde de forma estável (timeouts / falhas repetidas). */
  UNSTABLE: 'UNSTABLE',
  /** Circuit breaker ativo — WAHA temporariamente desabilitado no backend. */
  UNAVAILABLE: 'UNAVAILABLE',
};

function norm(raw) {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/-/g, '_');
}

/**
 * @param {string} provider
 * @param {unknown} rawStatus
 * @returns {keyof typeof SessionState | string}
 */
export function normalizeProviderSessionStatus(provider, rawStatus) {
  const p = String(provider || '').toLowerCase().trim();
  if (p === 'waha') {
    return mapWahaRawToSessionState(rawStatus);
  }
  return SessionState.UNKNOWN;
}

function mapWahaRawToSessionState(rawStatus) {
  const n = norm(rawStatus);
  if (!n || n === 'UNDEFINED' || n === 'NULL') return SessionState.UNKNOWN;

  if (['CONNECTED', 'WORKING', 'OPEN'].includes(n)) return SessionState.CONNECTED;

  if (n === 'SCAN_QR_CODE' || n === 'QR' || n === 'STARTED' || n === 'SCAN_QR') {
    return SessionState.QR_AVAILABLE;
  }

  if (n === 'STARTING') return SessionState.STARTING;

  if (n === 'STOPPED' || n === 'CLOSED' || n === 'LOGGED_OUT') return SessionState.DISCONNECTED;

  if (n === 'FAILED' || n === 'ERROR') return SessionState.FAILED;

  if (n.includes('RATE') && n.includes('LIMIT')) return SessionState.RATE_LIMITED;

  if (n === 'CONNECTING' || n === 'PAIRING' || n === 'QR_READY') return SessionState.CONNECTING;

  return SessionState.UNKNOWN;
}

export function isTerminalStateForPrepare(state) {
  return (
    state === SessionState.QR_AVAILABLE ||
    state === SessionState.CONNECTED ||
    state === SessionState.READY
  );
}
