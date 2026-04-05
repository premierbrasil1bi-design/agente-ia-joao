/**
 * Classificação de erros para o circuit breaker de sessão WhatsApp.
 *
 * === Alimentam o contador (indisponibilidade / degradação provável do provider ou rede até o provider) ===
 * - Códigos: PROVIDER_UNAVAILABLE, PROVIDER_TIMEOUT, HEALTHCHECK_TIMEOUT, SESSION_OPERATION_TIMEOUT, SESSION_TIMEOUT
 * - Rede: ECONNREFUSED, ENOTFOUND, ETIMEDOUT, ECONNABORTED
 * - WAHA_UNREACHABLE
 * - HTTP 5xx e 408 no erro propagado (quando httpStatus presente)
 *
 * === NÃO alimentam (configuração local, credencial, input, regra de negócio, estado de sessão, contenção) ===
 * - PROVIDER_CIRCUIT_OPEN (efeito, não causa nova falha de provider)
 * - UNAUTHORIZED / HTTP 401 / 403 (credencial ou permissão do cliente)
 * - SESSION_NOT_FOUND, INVALID_PROVIDER_STATE (nome/sessão inválida ou estado terminal da sessão)
 * - DISTRIBUTED_LOCK_TIMEOUT (contenção entre nós; não indica WAHA fora)
 * - QR_TIMEOUT, QR_NOT_AVAILABLE
 * - SESSION_START_FAILED, SESSION_CREATE_FAILED (fluxo de sessão; retry diferente)
 * - CONNECT_FAILED (genérico demais sem contexto — não contar por padrão)
 * - Erros não classificados: default é NÃO contar (evita abrir circuito por bug de aplicação ou 404 de recurso)
 */

import { SessionOpErrorCode } from './whatsappSessionErrors.js';

/** @type {Set<string>} */
const COUNT_TOWARD_CIRCUIT = new Set([
  SessionOpErrorCode.PROVIDER_UNAVAILABLE,
  SessionOpErrorCode.PROVIDER_TIMEOUT,
  SessionOpErrorCode.HEALTHCHECK_TIMEOUT,
  SessionOpErrorCode.SESSION_OPERATION_TIMEOUT,
  SessionOpErrorCode.SESSION_TIMEOUT,
]);

/** @type {Set<string>} */
const NEVER_COUNT_TOWARD_CIRCUIT = new Set([
  SessionOpErrorCode.PROVIDER_CIRCUIT_OPEN,
  SessionOpErrorCode.UNAUTHORIZED,
  SessionOpErrorCode.SESSION_NOT_FOUND,
  SessionOpErrorCode.INVALID_PROVIDER_STATE,
  SessionOpErrorCode.DISTRIBUTED_LOCK_TIMEOUT,
  SessionOpErrorCode.QR_TIMEOUT,
  SessionOpErrorCode.QR_NOT_AVAILABLE,
  SessionOpErrorCode.CONNECT_FAILED,
  SessionOpErrorCode.SESSION_START_FAILED,
  SessionOpErrorCode.SESSION_CREATE_FAILED,
]);

/**
 * @param {unknown} err
 * @returns {{ count: boolean, reason: string }}
 */
export function shouldCountFailureTowardSessionCircuit(err) {
  if (err == null) return { count: false, reason: 'no_error' };

  const code = /** @type {{ code?: string, httpStatus?: number, response?: { status?: number } }} */ (err).code;
  const httpStatus =
    /** @type {{ httpStatus?: number, response?: { status?: number } }} */ (err).httpStatus ??
    /** @type {{ response?: { status?: number } }} */ (err).response?.status;

  if (typeof code === 'string' && NEVER_COUNT_TOWARD_CIRCUIT.has(code)) {
    return { count: false, reason: `excluded_code:${code}` };
  }
  if (typeof code === 'string' && COUNT_TOWARD_CIRCUIT.has(code)) {
    return { count: true, reason: `provider_stress_code:${code}` };
  }

  if (code === 'WAHA_UNREACHABLE') return { count: true, reason: 'waha_unreachable' };
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ETIMEDOUT' || code === 'ECONNABORTED') {
    return { count: true, reason: `network:${code}` };
  }

  if (httpStatus === 401 || httpStatus === 403) {
    return { count: false, reason: `http_auth:${httpStatus}` };
  }

  if (typeof httpStatus === 'number' && httpStatus >= 500) {
    return { count: true, reason: `http_${httpStatus}` };
  }
  if (httpStatus === 408) {
    return { count: true, reason: 'http_408' };
  }

  return { count: false, reason: 'unclassified_default_no_count' };
}
