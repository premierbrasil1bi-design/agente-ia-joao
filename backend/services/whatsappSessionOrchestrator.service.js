/**
 * Orquestração central de sessão WhatsApp (preparação idempotente, locks, estados normalizados).
 * Implementação WAHA via wahaSession.adapter; outros providers podem estender com branches paralelos.
 *
 * Fluxo: ensureSessionPrepared (waha) → create se NOT_FOUND → start se DISCONNECTED → waitForValidStatus.
 * connectWahaChannel: healthcheck + ensure (sem createSession duplicado no provider).
 */

import { randomUUID } from 'crypto';
import { checkProviderHealth } from './providerHealth.service.js';
import { validateWahaEnv, wahaRequest } from './wahaHttp.js';
import { WAHA_CORE_DEFAULT_SESSION } from '../utils/wahaSession.util.js';
import {
  wahaAdapterGetSessionDetail,
  wahaAdapterCreateSessionRecord,
  wahaAdapterPostStart,
  extractStatusFromSessionEntry,
} from './wahaSession.adapter.js';
import { SessionState, normalizeProviderSessionStatus, isTerminalStateForPrepare } from './whatsapp/whatsappSessionState.js';
import { createSessionOpError, SessionOpErrorCode } from './whatsapp/whatsappSessionErrors.js';
import { logWhatsappSession } from './whatsapp/whatsappSessionLog.js';
import { whatsappLogger } from './whatsapp/whatsappSessionLogger.js';
import { withDistributedLock } from './distributedLock.service.js';
import { withTimeout } from '../utils/withTimeout.js';
import {
  assertSessionCircuitClosed,
  recordSessionCircuitFailureIfCountable,
  recordSessionCircuitSuccess,
} from './whatsapp/sessionProviderCircuitBreaker.js';
import { buildCanonicalConnectResult } from '../utils/whatsappCanonicalContracts.js';
import { ensureWahaSession } from './wahaHttp.js';

const WAHA_PROVIDER = 'waha';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isDebugSessionPoll() {
  const v = String(process.env.WAHA_SESSION_DEBUG_POLL || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/**
 * Comportamento específico WAHA FREE: remove sessão default antes de novo vínculo (single-session).
 * Não aplicar quando WAHA_MULTI_SESSION=true.
 *
 * @param {{ correlationId?: string|null }} [opts]
 * @returns {Promise<{ applied: boolean, reason?: string }>}
 */
export async function applyWahaFreeSessionResetIfNeeded(opts = {}) {
  if (process.env.WAHA_MULTI_SESSION === 'true') {
    return { applied: false, reason: 'multi_session_enabled' };
  }
  const correlationId = opts.correlationId ?? null;
  try {
    logWhatsappSession({
      operation: 'waha_free_mode_reset',
      provider: WAHA_PROVIDER,
      sessionName: WAHA_CORE_DEFAULT_SESSION,
      correlationId,
      result: 'delete_default_attempt',
    });
    await wahaRequest(
      'DELETE',
      `/api/sessions/${encodeURIComponent(WAHA_CORE_DEFAULT_SESSION)}`,
    );
    return { applied: true };
  } catch {
    return { applied: false, reason: 'delete_failed_or_absent' };
  }
}

const DEFAULT_POLL_MS = parseInt(process.env.WAHA_SESSION_POLL_MS || '2000', 10) || 2000;
const DEFAULT_TIMEOUT_MS = parseInt(process.env.WAHA_SESSION_WAIT_TIMEOUT_MS || '40000', 10) || 40000;
const MAX_START_ATTEMPTS = parseInt(process.env.WAHA_SESSION_MAX_START_ATTEMPTS || '12', 10) || 12;
const START_SETTLE_MS = 1500;
const DISTRIBUTED_LOCK_TTL_MS = parseInt(process.env.WHATSAPP_DISTRIBUTED_LOCK_TTL_MS || '120000', 10) || 120000;
const ENSURE_OPERATION_MS = parseInt(process.env.WHATSAPP_ENSURE_OPERATION_TIMEOUT_MS || '180000', 10) || 180000;
const CONNECT_OPERATION_MS = parseInt(process.env.WHATSAPP_CONNECT_OPERATION_TIMEOUT_MS || '210000', 10) || 210000;
const CONNECT_HEALTHCHECK_MS = parseInt(process.env.WHATSAPP_HEALTHCHECK_TIMEOUT_MS || '20000', 10) || 20000;

/** @type {Map<string, Promise<unknown>>} */
const sessionLocks = new Map();

export function buildSessionLockKey(provider, tenantId, sessionName) {
  const t = tenantId != null && String(tenantId).trim() !== '' ? String(tenantId).trim() : '_';
  const s = String(sessionName || '').trim();
  return `${String(provider || '').toLowerCase()}:${t}:${s}`;
}

/**
 * @param {object} ctx
 * @param {string} ctx.sessionName
 * @param {string|null} [ctx.tenantId]
 * @param {string|null} [ctx.channelId]
 * @param {string|null} [ctx.correlationId]
 * @param {number} [ctx.pollMs]
 * @param {number} [ctx.timeoutMs]
 * @returns {Promise<{ state: string, durationMs: number, attempts: number, rawStatus: string|null }>}
 */
export async function waitForValidWahaStatus(ctx) {
  const sessionName = String(ctx.sessionName || '').trim();
  const correlationId = ctx.correlationId ?? randomUUID();
  const pollMs = ctx.pollMs ?? DEFAULT_POLL_MS;
  const timeoutMs = ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const validStates = ctx.validStates ?? [
    SessionState.QR_AVAILABLE,
    SessionState.CONNECTED,
    SessionState.READY,
  ];

  const startTime = Date.now();
  let attempts = 0;
  let startCount = 0;

  while (true) {
    attempts += 1;
    const elapsed = Date.now() - startTime;
    if (elapsed > timeoutMs) {
      logWhatsappSession({
        operation: 'wait_valid_status',
        provider: WAHA_PROVIDER,
        tenantId: ctx.tenantId ?? null,
        channelId: ctx.channelId ?? null,
        sessionName,
        correlationId,
        currentState: 'timeout',
        durationMs: elapsed,
        attempts,
        result: 'timeout',
        errorCode: SessionOpErrorCode.SESSION_TIMEOUT,
      });
      throw createSessionOpError(
        SessionOpErrorCode.SESSION_TIMEOUT,
        '[WAHA] timeout aguardando sessão pronta',
        { correlationId, attempts, durationMs: elapsed },
      );
    }

    const detail = await wahaAdapterGetSessionDetail(sessionName);
    if (!detail.found) {
      await sleep(pollMs);
      continue;
    }

    const rawStatus = extractStatusFromSessionEntry(detail.session) ?? detail.status;
    const internal = normalizeProviderSessionStatus(WAHA_PROVIDER, rawStatus);
    const statusLog = rawStatus != null && String(rawStatus).trim() !== '' ? String(rawStatus).trim() : internal;

    if (isDebugSessionPoll()) {
      logWhatsappSession({
        operation: 'wait_valid_status_poll',
        provider: WAHA_PROVIDER,
        tenantId: ctx.tenantId ?? null,
        channelId: ctx.channelId ?? null,
        sessionName,
        correlationId,
        currentState: internal,
        durationMs: Date.now() - startTime,
        attempts,
        result: 'poll',
        rawStatus: statusLog,
      });
      whatsappLogger.debug('waha_status_poll', {
        operation: 'wait_valid_status_poll',
        sessionName,
        correlationId,
        rawStatus: statusLog,
      });
    }

    if (internal === SessionState.FAILED) {
      throw createSessionOpError(SessionOpErrorCode.INVALID_PROVIDER_STATE, '[WAHA] sessão falhou', {
        correlationId,
        rawStatus,
      });
    }

    if (validStates.includes(internal) || isTerminalStateForPrepare(internal)) {
      logWhatsappSession({
        operation: 'wait_valid_status_summary',
        provider: WAHA_PROVIDER,
        tenantId: ctx.tenantId ?? null,
        channelId: ctx.channelId ?? null,
        sessionName,
        correlationId,
        currentState: internal,
        durationMs: Date.now() - startTime,
        attempts,
        result: 'terminal',
        rawStatus: statusLog,
      });
      return {
        state: internal,
        durationMs: Date.now() - startTime,
        attempts,
        rawStatus: rawStatus != null ? String(rawStatus) : null,
      };
    }

    if (internal === SessionState.STARTING) {
      await sleep(pollMs);
      continue;
    }

    if (internal === SessionState.DISCONNECTED) {
      if (startCount >= MAX_START_ATTEMPTS) {
        throw createSessionOpError(
          SessionOpErrorCode.SESSION_START_FAILED,
          `WAHA session STOPPED: excedeu tentativas de start (${sessionName})`,
          { correlationId },
        );
      }
      startCount += 1;
      whatsappLogger.info('waha_session_start', {
        operation: 'session_start',
        provider: WAHA_PROVIDER,
        sessionName,
        correlationId,
        reason: 'wait_loop_disconnected',
      });
      logWhatsappSession({
        operation: 'session_start',
        provider: WAHA_PROVIDER,
        tenantId: ctx.tenantId ?? null,
        channelId: ctx.channelId ?? null,
        sessionName,
        correlationId,
        currentState: internal,
        result: 'start',
      });
      await wahaAdapterPostStart(sessionName);
      await sleep(START_SETTLE_MS);
      continue;
    }

    await sleep(pollMs);
  }
}

/**
 * Núcleo idempotente de prepare (executa sob lock distribuído + timeout global).
 * @param {{ sessionName: string, tenantId?: string|null, channelId?: string|null, pollMs?: number, timeoutMs?: number }} ctx
 */
async function executeEnsureWahaSessionPreparedBody(ctx, correlationId) {
  const sessionName = String(ctx.sessionName || '').trim();
  const tenantId = ctx.tenantId ?? null;
  const channelId = ctx.channelId ?? null;
  const t0 = Date.now();

  await ensureWahaSession(sessionName);

  let detail = await wahaAdapterGetSessionDetail(sessionName);

  if (detail.found) {
    const raw0 = extractStatusFromSessionEntry(detail.session) ?? detail.status;
    const st0 = normalizeProviderSessionStatus(WAHA_PROVIDER, raw0);
    if (st0 === SessionState.CONNECTED) {
      logWhatsappSession({
        operation: 'ensure_session_ready',
        provider: WAHA_PROVIDER,
        tenantId,
        channelId,
        sessionName,
        correlationId,
        currentState: st0,
        durationMs: Date.now() - t0,
        result: 'already_connected',
      });
      return {
        state: SessionState.CONNECTED,
        durationMs: Date.now() - t0,
        waitAttempts: 0,
        rawStatus: raw0 != null ? String(raw0) : null,
      };
    }
  }

  if (!detail.found) {
    whatsappLogger.info('waha_session_create', {
      operation: 'session_create',
      provider: WAHA_PROVIDER,
      sessionName,
      correlationId,
      tenantId,
      channelId,
    });
    logWhatsappSession({
      operation: 'session_create',
      provider: WAHA_PROVIDER,
      tenantId,
      channelId,
      sessionName,
      correlationId,
      currentState: SessionState.NOT_FOUND,
      result: 'create',
    });
    await wahaAdapterCreateSessionRecord(sessionName);
    whatsappLogger.info('waha_session_start', {
      operation: 'session_start',
      provider: WAHA_PROVIDER,
      sessionName,
      correlationId,
      reason: 'after_create',
    });
    logWhatsappSession({
      operation: 'session_start',
      provider: WAHA_PROVIDER,
      tenantId,
      channelId,
      sessionName,
      correlationId,
      currentState: SessionState.CREATED,
      result: 'start_after_create',
    });
    await wahaAdapterPostStart(sessionName);
    await sleep(START_SETTLE_MS);
  } else {
    const raw0 = extractStatusFromSessionEntry(detail.session) ?? detail.status;
    const st0 = normalizeProviderSessionStatus(WAHA_PROVIDER, raw0);
    if (st0 === SessionState.DISCONNECTED) {
      whatsappLogger.info('waha_session_start', {
        operation: 'session_start',
        provider: WAHA_PROVIDER,
        sessionName,
        correlationId,
        reason: 'disconnected_existing',
      });
      logWhatsappSession({
        operation: 'session_start',
        provider: WAHA_PROVIDER,
        tenantId,
        channelId,
        sessionName,
        correlationId,
        currentState: st0,
        result: 'start_stopped',
      });
      await wahaAdapterPostStart(sessionName);
      await sleep(START_SETTLE_MS);
    }
  }

  whatsappLogger.info('waha_ensure_wait', {
    operation: 'ensure_wait_poll',
    sessionName,
    correlationId,
  });
  logWhatsappSession({
    operation: 'ensure_wait_poll',
    provider: WAHA_PROVIDER,
    tenantId,
    channelId,
    sessionName,
    correlationId,
    result: 'wait_begin',
  });

  const wait = await waitForValidWahaStatus({
    sessionName,
    tenantId,
    channelId,
    correlationId,
    pollMs: ctx.pollMs,
    timeoutMs: ctx.timeoutMs,
  });

  logWhatsappSession({
    operation: 'ensure_session_ready',
    provider: WAHA_PROVIDER,
    tenantId,
    channelId,
    sessionName,
    correlationId,
    currentState: wait.state,
    durationMs: Date.now() - t0,
    attempts: wait.attempts,
    result: 'ok',
  });

  return {
    state: wait.state,
    durationMs: Date.now() - t0,
    waitAttempts: wait.attempts,
    rawStatus: wait.rawStatus,
  };
}

/**
 * Única porta de entrada para preparar sessão WAHA (idempotente, lock local + lock distribuído opcional).
 */
export async function ensureWahaSessionPrepared(ctx) {
  const sessionName = String(ctx.sessionName || '').trim();
  if (!sessionName) {
    throw createSessionOpError(SessionOpErrorCode.SESSION_NOT_FOUND, 'Nome de sessão WAHA inválido');
  }

  try {
    validateWahaEnv();
  } catch (e) {
    throw createSessionOpError(SessionOpErrorCode.PROVIDER_UNAVAILABLE, e?.message || 'WAHA não configurado', {
      cause: e,
    });
  }

  const tenantId = ctx.tenantId ?? null;
  const correlationId = ctx.correlationId ?? randomUUID();
  const lockKey = buildSessionLockKey(WAHA_PROVIDER, tenantId, sessionName);

  const existing = sessionLocks.get(lockKey);
  if (existing) {
    logWhatsappSession({
      operation: 'ensure_session_coalesce',
      provider: WAHA_PROVIDER,
      tenantId,
      channelId: ctx.channelId ?? null,
      sessionName,
      correlationId,
      result: 'lock_reuse',
    });
    return existing;
  }

  const run = (async () => {
    try {
      return await withDistributedLock(
        lockKey,
        DISTRIBUTED_LOCK_TTL_MS,
        async () =>
          withTimeout(executeEnsureWahaSessionPreparedBody(ctx, correlationId), ENSURE_OPERATION_MS, {
            code: SessionOpErrorCode.SESSION_OPERATION_TIMEOUT,
            message: 'ensureWahaSessionPrepared excedeu tempo global',
            correlationId,
            operation: 'ensure_waha_prepared',
          }),
        { correlationId },
      );
    } finally {
      sessionLocks.delete(lockKey);
    }
  })();

  sessionLocks.set(lockKey, run);
  return run;
}

/**
 * Connect WAHA: healthcheck + `ensureWahaSessionPrepared` (sem segundo `createSession` no provider).
 *
 * Contrato de retorno (estado real da sessão após prepare):
 * - `ok: true` quando prepare concluiu sem erro.
 * - `connected: true` **somente** se `prepare.state === CONNECTED` (não mascarar sessão aguardando QR).
 * - `state`: valor normalizado (`SessionState`) após ensure.
 * - `prepare`: objeto retornado por `ensureWahaSessionPrepared` (duração, tentativas, rawStatus, etc.).
 * - `correlationId`: rastreio de operação.
 *
 * @param {{ sessionName: string, tenantId?: string|null, channelId?: string|null, correlationId?: string|null }} ctx
 * @returns {Promise<{
 *   ok: true,
 *   connected: boolean,
 *   sessionName: string,
 *   state: string,
 *   prepare: object,
 *   correlationId: string,
 *   canonical: object
 * }>}
 */
export async function connectWahaChannel(ctx) {
  if (Array.isArray(ctx.providers) && ctx.providers.length > 0) {
    const [{ executeWithProviderFallback }, facade] = await Promise.all([
      import('./whatsapp/providerFallback.service.js'),
      import('./whatsappSessionProvider.facade.js'),
    ]);
    return executeWithProviderFallback(
      (p) => facade.connectProviderSessionDirect(p, { ...ctx, providers: undefined }),
      { ...ctx, providers: ctx.providers },
    );
  }

  const sessionName = String(ctx.sessionName || '').trim();
  const tenantId = ctx.tenantId ?? null;
  const channelId = ctx.channelId ?? null;
  const correlationId = ctx.correlationId ?? randomUUID();
  const t0 = Date.now();

  try {
    assertSessionCircuitClosed(WAHA_PROVIDER, { correlationId });
  } catch (e) {
    if (e?.code === 'PROVIDER_CIRCUIT_OPEN') {
      throw createSessionOpError(SessionOpErrorCode.PROVIDER_CIRCUIT_OPEN, e.message || 'Circuito aberto', {
        correlationId,
      });
    }
    throw e;
  }

  const inner = async () => {
    logWhatsappSession({
      operation: 'connect_waha_start',
      provider: WAHA_PROVIDER,
      tenantId,
      channelId,
      sessionName,
      correlationId,
      result: 'start',
    });

    await applyWahaFreeSessionResetIfNeeded({ correlationId });

    try {
      await withTimeout(checkProviderHealth('waha'), CONNECT_HEALTHCHECK_MS, {
        code: SessionOpErrorCode.HEALTHCHECK_TIMEOUT,
        message: `Healthcheck WAHA excedeu ${CONNECT_HEALTHCHECK_MS}ms`,
        correlationId,
        operation: 'connect_waha_health',
      });
    } catch (e) {
      const code = e?.code === SessionOpErrorCode.HEALTHCHECK_TIMEOUT ? SessionOpErrorCode.HEALTHCHECK_TIMEOUT : SessionOpErrorCode.PROVIDER_UNAVAILABLE;
      logWhatsappSession({
        operation: 'connect_waha_health',
        provider: WAHA_PROVIDER,
        tenantId,
        channelId,
        sessionName,
        correlationId,
        durationMs: Date.now() - t0,
        result: 'error',
        errorCode: code,
        errorMessage: e?.message,
      });
      if (e?.code === SessionOpErrorCode.HEALTHCHECK_TIMEOUT) throw e;
      throw createSessionOpError(SessionOpErrorCode.PROVIDER_UNAVAILABLE, e?.message || 'WAHA indisponível', {
        cause: e,
        correlationId,
      });
    }

    const prep = await ensureWahaSessionPrepared({
      sessionName,
      tenantId,
      channelId,
      correlationId,
    });

    const connected = prep.state === SessionState.CONNECTED;

    logWhatsappSession({
      operation: 'connect_waha_done',
      provider: WAHA_PROVIDER,
      tenantId,
      channelId,
      sessionName,
      correlationId,
      currentState: prep.state,
      durationMs: Date.now() - t0,
      result: 'ok',
    });

    const canonical = buildCanonicalConnectResult({
      success: true,
      provider: WAHA_PROVIDER,
      session: sessionName,
      connected,
      state: prep.state,
      prepare: prep,
      correlationId,
      error: null,
      meta: { lockScope: 'ensure_waha_session_prepared' },
    });

    return {
      ok: true,
      connected,
      sessionName,
      state: prep.state,
      prepare: prep,
      correlationId,
      canonical,
    };
  };

  try {
    const out = await withTimeout(inner(), CONNECT_OPERATION_MS, {
      code: SessionOpErrorCode.SESSION_OPERATION_TIMEOUT,
      message: 'connectWahaChannel excedeu tempo global',
      correlationId,
      operation: 'connect_waha',
    });
    recordSessionCircuitSuccess(WAHA_PROVIDER, { correlationId });
    return out;
  } catch (e) {
    recordSessionCircuitFailureIfCountable(WAHA_PROVIDER, e, { correlationId });
    throw e;
  }
}
