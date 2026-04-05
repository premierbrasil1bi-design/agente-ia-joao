/** Códigos operacionais padronizados (sessão / WhatsApp). */

export const SessionOpErrorCode = {
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  PROVIDER_TIMEOUT: 'PROVIDER_TIMEOUT',
  PROVIDER_CIRCUIT_OPEN: 'PROVIDER_CIRCUIT_OPEN',
  HEALTHCHECK_TIMEOUT: 'HEALTHCHECK_TIMEOUT',
  SESSION_NOT_FOUND: 'SESSION_NOT_FOUND',
  SESSION_CREATE_FAILED: 'SESSION_CREATE_FAILED',
  SESSION_START_FAILED: 'SESSION_START_FAILED',
  SESSION_TIMEOUT: 'SESSION_TIMEOUT',
  SESSION_OPERATION_TIMEOUT: 'SESSION_OPERATION_TIMEOUT',
  QR_TIMEOUT: 'QR_TIMEOUT',
  QR_NOT_AVAILABLE: 'QR_NOT_AVAILABLE',
  DISTRIBUTED_LOCK_TIMEOUT: 'DISTRIBUTED_LOCK_TIMEOUT',
  INVALID_PROVIDER_STATE: 'INVALID_PROVIDER_STATE',
  CONNECT_FAILED: 'CONNECT_FAILED',
  UNAUTHORIZED: 'UNAUTHORIZED',
};

/**
 * @param {string} code
 * @param {string} message
 * @param {Record<string, unknown>} [extra]
 */
export function createSessionOpError(code, message, extra = {}) {
  const e = new Error(message || code);
  e.name = 'SessionOperationError';
  e.code = code;
  Object.assign(e, extra);
  return e;
}
