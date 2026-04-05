/**
 * Circuit breaker simples por provider para operações de sessão WhatsApp (memória do processo).
 * Complementa providerHealth (HTTP); foca em falhas consecutivas de ensure/connect.
 *
 * Use `recordSessionCircuitFailureIfCountable` no fluxo de connect — só incrementa quando
 * {@link ./sessionCircuitFailurePolicy.js} classifica como indisponibilidade/degradação do provider.
 * Ver documentação em `sessionCircuitFailurePolicy.js` (o que conta / o que não conta).
 */

import { whatsappLogger } from './whatsappSessionLogger.js';
import { shouldCountFailureTowardSessionCircuit } from './sessionCircuitFailurePolicy.js';

/** @typedef {'CLOSED'|'OPEN'|'HALF_OPEN'} CircuitPhase */

/** @type {Map<string, { failures: number, openUntil: number, phase: CircuitPhase, halfOpenProbe: boolean, halfOpenAttempts: number }>} */
const byProvider = new Map();

const DEFAULT_FAILURE_THRESHOLD = parseInt(process.env.WHATSAPP_SESSION_CB_FAILURE_THRESHOLD || '5', 10) || 5;
const DEFAULT_OPEN_MS = parseInt(process.env.WHATSAPP_SESSION_CB_OPEN_MS || '45000', 10) || 45000;

function bucket(provider) {
  const p = String(provider || '').toLowerCase().trim() || '_';
  if (!byProvider.has(p)) {
    byProvider.set(p, {
      failures: 0,
      openUntil: 0,
      phase: 'CLOSED',
      halfOpenProbe: false,
      halfOpenAttempts: 0,
    });
  }
  return byProvider.get(p);
}

/**
 * @param {string} provider
 * @param {{ correlationId?: string|null }} [ctx]
 */
function resetSessionCircuit(provider, ctx = {}) {
  const b = bucket(provider);
  b.failures = 0;
  b.openUntil = 0;
  b.phase = 'CLOSED';
  b.halfOpenProbe = false;
  b.halfOpenAttempts = 0;
  whatsappLogger.warn('whatsapp_session_circuit', {
    operation: 'circuit_reset_half_open_stuck',
    provider,
    phase: 'CLOSED',
    correlationId: ctx.correlationId ?? null,
  });
}

/**
 * @param {string} provider
 * @param {{ correlationId?: string|null }} [ctx]
 */
export function assertSessionCircuitClosed(provider, ctx = {}) {
  const b = bucket(provider);
  const now = Date.now();
  if (b.phase === 'OPEN' && now < b.openUntil) {
    whatsappLogger.warn('whatsapp_session_circuit', {
      operation: 'circuit_block',
      provider,
      phase: 'OPEN',
      correlationId: ctx.correlationId ?? null,
      openUntil: b.openUntil,
    });
    const err = new Error('Provider em circuito aberto (sessão WhatsApp). Aguarde e tente novamente.');
    err.code = 'PROVIDER_CIRCUIT_OPEN';
    err.provider = provider;
    err.correlationId = ctx.correlationId ?? null;
    throw err;
  }
  if (b.phase === 'OPEN' && now >= b.openUntil) {
    b.phase = 'HALF_OPEN';
    b.halfOpenProbe = true;
    b.failures = 0;
    b.halfOpenAttempts = 0;
    whatsappLogger.info('whatsapp_session_circuit', {
      operation: 'circuit_half_open',
      provider,
      phase: 'HALF_OPEN',
      correlationId: ctx.correlationId ?? null,
    });
  }
  if (b.phase === 'HALF_OPEN') {
    b.halfOpenAttempts = (b.halfOpenAttempts || 0) + 1;
    if (b.halfOpenAttempts > 3) {
      console.warn('[Circuit] HALF_OPEN preso, resetando circuito', { provider });
      resetSessionCircuit(provider, ctx);
    }
  }
}

/**
 * @param {string} provider
 * @param {{ correlationId?: string|null }} [ctx]
 */
export function recordSessionCircuitSuccess(provider, ctx = {}) {
  const b = bucket(provider);
  const prev = b.phase;
  b.failures = 0;
  b.openUntil = 0;
  b.phase = 'CLOSED';
  b.halfOpenProbe = false;
  b.halfOpenAttempts = 0;
  if (prev !== 'CLOSED') {
    whatsappLogger.info('whatsapp_session_circuit', {
      operation: 'circuit_closed',
      provider,
      phase: 'CLOSED',
      correlationId: ctx.correlationId ?? null,
    });
  }
}

/**
 * @param {string} provider
 * @param {Error} [err]
 * @param {{ correlationId?: string|null }} [ctx]
 */
/**
 * Registra falha no circuito somente se o erro indicar stress real do provider (ver policy).
 *
 * @param {string} provider
 * @param {unknown} err
 * @param {{ correlationId?: string|null }} [ctx]
 */
function isClientAuthError(err) {
  if (err == null || typeof err !== 'object') return false;
  const st = err.httpStatus ?? err.response?.status;
  return st === 401 || st === 403 || err.code === 'UNAUTHORIZED';
}

export function recordSessionCircuitFailureIfCountable(provider, err, ctx = {}) {
  const { count, reason } = shouldCountFailureTowardSessionCircuit(err);
  const b = bucket(provider);
  if (!count) {
    whatsappLogger.debug('whatsapp_session_circuit_skip', {
      operation: 'failure_not_counted',
      provider,
      correlationId: ctx.correlationId ?? null,
      reason,
      errorCode: err && typeof err === 'object' && 'code' in err ? err.code : undefined,
    });
    if (b.phase === 'HALF_OPEN' && isClientAuthError(err)) {
      recordSessionCircuitSuccess(provider, ctx);
    }
    return;
  }
  recordSessionCircuitFailure(provider, err, ctx);
}

export function recordSessionCircuitFailure(provider, err, ctx = {}) {
  const b = bucket(provider);
  b.failures += 1;
  const threshold = DEFAULT_FAILURE_THRESHOLD;
  if (b.phase === 'HALF_OPEN') {
    b.phase = 'OPEN';
    b.openUntil = Date.now() + DEFAULT_OPEN_MS;
    b.halfOpenProbe = false;
    b.halfOpenAttempts = 0;
    whatsappLogger.warn('whatsapp_session_circuit', {
      operation: 'circuit_open',
      provider,
      phase: 'OPEN',
      correlationId: ctx.correlationId ?? null,
      errorMessage: err?.message,
      reason: 'half_open_failed',
    });
    return;
  }
  if (b.failures >= threshold) {
    b.phase = 'OPEN';
    b.openUntil = Date.now() + DEFAULT_OPEN_MS;
    b.halfOpenAttempts = 0;
    whatsappLogger.warn('whatsapp_session_circuit', {
      operation: 'circuit_open',
      provider,
      phase: 'OPEN',
      correlationId: ctx.correlationId ?? null,
      failures: b.failures,
      errorMessage: err?.message,
    });
  }
}
