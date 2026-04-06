/**
 * Cliente WAHA — HTTP via wahaHttp (WAHA_API_URL; sem API key no container WAHA).
 *
 * Fluxo de sessão (produção):
 * - Preparação idempotente: whatsappSessionOrchestrator.ensureWahaSessionPrepared (via ensureSessionReady).
 * - Connect do provider: whatsappSessionOrchestrator.connectWahaChannel (health + FREE reset opcional + ensure).
 * - createSession: apenas FREE reset + ensure (compat legado; não duplicar após connect do provider).
 * - Estados normalizados: whatsapp/whatsappSessionState (agnóstico); WAHA mapeado em normalizeProviderSessionStatus.
 */

import { config } from '../config/env.js';
import { checkProviderHealth } from './providerHealth.service.js';
import {
  wahaRequest,
  validateWahaEnv,
  fetchWahaSessionQrcodeRest,
  getWahaQr,
  isWahaAlive,
} from './wahaHttp.js';
import {
  withWahaTimeout,
  wahaStructuredLog,
  withWahaSessionLock,
  beginWahaQrPoll,
  endWahaQrPoll,
  WAHA_GLOBAL_TIMEOUT_MS,
  WAHA_CONSECUTIVE_FAIL_STOP,
} from './whatsapp/wahaHardening.js';
import { getCurrentQr } from './wahaQrCapture.js';
import { resolveWahaSessionName, WAHA_CORE_DEFAULT_SESSION } from '../utils/wahaSession.util.js';
import { applyWahaFreeSessionResetIfNeeded } from './whatsappSessionOrchestrator.service.js';
import { ensureProviderSessionPrepared } from './whatsappSessionProvider.facade.js';
import { whatsappLogger } from './whatsapp/whatsappSessionLogger.js';
import { SessionState } from './whatsapp/whatsappSessionState.js';
import { buildUnifiedQrResponse } from '../utils/whatsappQrContract.js';
import { normalizeQrResult } from '../utils/normalizeQrResult.js';
import { extractQrPayload, toQrDataUrl } from '../utils/extractQrPayload.js';
import { randomUUID } from 'node:crypto';
import {
  trackQrRequest,
  trackQrSuccess,
  trackQrPending,
  trackQrFailure,
  trackUnstable,
  trackOffline,
  recordQrFlowDurationMs,
  checkCriticalMetricsState,
} from './wahaMetrics.service.js';
import {
  isCircuitOpen,
  recordSuccessfulQrFlow,
  resetConsecutiveQrSuccess,
} from './wahaCircuitBreaker.service.js';

export { resolveSessionName } from '../utils/resolveSessionName.js';
export { resolveWahaSessionName, WAHA_CORE_DEFAULT_SESSION } from '../utils/wahaSession.util.js';

const WAHA_URL_RESOLVED = (
  process.env.WAHA_API_URL ||
  process.env.WAHA_URL ||
  process.env.WAHA_BASE_URL ||
  ''
).trim();

function assertWahaConfig() {
  try {
    validateWahaEnv();
  } catch (e) {
    throw new Error(e?.message || 'WAHA_API_URL não configurado');
  }
}

function wahaErr(err) {
  const st = err.response?.status ?? err.httpStatus;
  const msg =
    st === 401
      ? 'WAHA: não autorizado (remova WAHA_API_KEY do WAHA/Docker se a imagem não usar essa variável).'
      : err.message || 'Erro na API WAHA.';
  return {
    ok: false,
    error: msg,
    httpStatus: st,
    code: st === 401 ? 'UNAUTHORIZED' : undefined,
  };
}

function normalizeSessionName(name) {
  const s = name == null ? '' : String(name).trim();
  if (!s) throw new Error('Nome de sessão WAHA inválido');
  return s;
}

/**
 * Nome efetivo da sessão: PLUS + ctx → tenant_channel; FREE + ctx → default; senão valida `name`.
 * @param {string} name
 * @param {{ channelId?: string | null; tenantId?: string | null }} [ctx]
 */
function resolveWahaRequestSession(name, ctx = {}) {
  if (ctx.tenantId != null && ctx.channelId != null) {
    return resolveWahaSessionName({
      tenantId: ctx.tenantId,
      channelId: ctx.channelId,
    });
  }
  return normalizeSessionName(name);
}

function logWahaContext(sessionName, channelId, tenantId, correlationId = null) {
  const cid =
    correlationId != null && String(correlationId).trim() !== ''
      ? String(correlationId).trim().slice(0, 32)
      : null;
  const cidPart = cid ? `[CID:${cid}]` : '';
  console.log(`[WAHA]${cidPart} URL:`, config.providers.waha.url || process.env.WAHA_API_URL);
  console.log(`[WAHA]${cidPart} Session:`, sessionName);
  console.log(`[WAHA]${cidPart} PROVIDER:`, 'waha');
  if (channelId != null) console.log(`[WAHA]${cidPart} channelId:`, channelId);
  if (tenantId != null) console.log(`[WAHA]${cidPart} tenantId:`, tenantId);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Rate limit leve: no máximo 1 início de fluxo getQrCode por sessão a cada 2s. */
const wahaQrRateMap = new Map();
const WAHA_QR_MIN_INTERVAL_MS = 2000;

async function enforceWahaQrRateLimit(sessionName) {
  const key = String(sessionName || 'default').trim() || 'default';
  const now = Date.now();
  const last = wahaQrRateMap.get(key) ?? 0;
  const waitMs = Math.max(0, WAHA_QR_MIN_INTERVAL_MS - (now - last));
  if (waitMs > 0) await sleep(waitMs);
  wahaQrRateMap.set(key, Date.now());
}

/** Contadores de resultado exposto ao cliente (evita duplicar OFFLINE/UNSTABLE já contados no wait). */
function recordTerminalQrMetrics(stateRaw) {
  const s = String(stateRaw ?? '').toUpperCase();
  if (s === 'QR_AVAILABLE') trackQrSuccess();
  else if (s === 'PENDING') trackQrPending();
  else if (s === 'CANCELLED') trackQrFailure();
}

function isWahaQrPollDebug() {
  const v = String(process.env.WAHA_SESSION_DEBUG_POLL || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

const WAHA_QR_RETRIES = parseInt(process.env.WHATSAPP_WAHA_QR_RETRIES || '10', 10) || 10;
const WAHA_QR_DELAY_MS = parseInt(process.env.WHATSAPP_WAHA_QR_DELAY_MS || '2000', 10) || 2000;

/**
 * Polling inteligente em /api/{session}/auth/qr após sessão garantida.
 * @param {string} [session]
 * @param {number} [retries]
 * @param {number} [delayMs]
 * @param {{ skipHealthCheck?: boolean, correlationId?: string|null }} [opts]
 */
export async function waitForWahaQr(
  session = 'default',
  retries = WAHA_QR_RETRIES,
  delayMs = WAHA_QR_DELAY_MS,
  opts = {},
) {
  const name = String(session ?? 'default').trim() || 'default';
  const cid = opts.correlationId ?? null;
  const logExtra = (base = {}) => ({ ...base, correlationId: cid });

  if (opts.skipHealthCheck !== true) {
    const alive = await isWahaAlive();
    if (!alive) {
      wahaStructuredLog(name, 'HEALTH_FAIL', logExtra());
      trackOffline();
      return {
        success: false,
        state: 'OFFLINE',
        qr: null,
        format: null,
        provider: 'waha',
        error: 'WAHA unavailable',
      };
    }
  }

  const r = Math.max(1, retries);
  const base = Math.max(200, delayMs);
  const control = beginWahaQrPoll(name);
  let consecutiveFailures = 0;
  let consecutiveTimeouts = 0;

  try {
    for (let i = 0; i < r; i++) {
      if (control.cancelled) {
        wahaStructuredLog(name, 'QR_POLL_CANCELLED', logExtra());
        return {
          success: false,
          state: 'CANCELLED',
          qr: null,
          format: null,
          provider: 'waha',
          error: 'QR polling superseded',
        };
      }

      trackQrRequest();
      wahaStructuredLog(name, 'QR_ATTEMPT', logExtra({ try: i + 1, max: r }));

      try {
        const qrData = await withWahaTimeout(
          getWahaQr(name, { quiet: true }),
          WAHA_GLOBAL_TIMEOUT_MS,
        );

        if (!qrData.success) {
          consecutiveFailures += 1;
          consecutiveTimeouts = 0;
          trackQrFailure();
          wahaStructuredLog(name, 'QR_FETCH_ERROR', logExtra({ try: i + 1, err: qrData.error || 'fail' }));
          if (consecutiveFailures >= WAHA_CONSECUTIVE_FAIL_STOP) {
            wahaStructuredLog(name, 'QR_FAIL_STOP_OFFLINE', logExtra());
            trackOffline();
            return {
              success: false,
              state: 'OFFLINE',
              qr: null,
              format: null,
              provider: 'waha',
              error: 'WAHA temporarily unavailable',
            };
          }
        } else if (qrData?.qr) {
          consecutiveFailures = 0;
          consecutiveTimeouts = 0;
          wahaStructuredLog(name, 'QR_READY', logExtra({ try: i + 1 }));
          const rawQr = qrData.qr;
          let format = null;
          if (typeof rawQr === 'string') {
            if (rawQr.startsWith('data:image')) format = 'base64';
            else if (rawQr.length > 0 && rawQr.length < 2000 && !rawQr.includes('base64')) format = 'ascii';
            else format = 'base64';
          }
          return {
            success: true,
            state: 'QR_AVAILABLE',
            qr: rawQr,
            format,
            provider: 'waha',
            raw: qrData.raw,
          };
        } else {
          consecutiveFailures = 0;
          consecutiveTimeouts = 0;
          wahaStructuredLog(name, 'QR_PENDING', logExtra({ try: i + 1 }));
        }
      } catch (err) {
        const msg = err?.message || String(err);
        consecutiveFailures += 1;
        trackQrFailure();
        if (msg === 'WAHA_TIMEOUT') {
          consecutiveTimeouts += 1;
          wahaStructuredLog(name, 'TIMEOUT', logExtra({ try: i + 1 }));
          if (consecutiveTimeouts >= 2) {
            wahaStructuredLog(name, 'UNSTABLE', logExtra());
            trackUnstable();
            return {
              success: false,
              state: 'UNSTABLE',
              qr: null,
              format: null,
              provider: 'waha',
              error: 'WAHA not responding properly',
            };
          }
        } else {
          consecutiveTimeouts = 0;
          wahaStructuredLog(name, 'QR_FETCH_ERROR', logExtra({ try: i + 1, err: msg }));
        }

        if (consecutiveFailures >= WAHA_CONSECUTIVE_FAIL_STOP) {
          wahaStructuredLog(name, 'QR_FAIL_STOP_OFFLINE', logExtra());
          trackOffline();
          return {
            success: false,
            state: 'OFFLINE',
            qr: null,
            format: null,
            provider: 'waha',
            error: 'WAHA temporarily unavailable',
          };
        }
      }

      if (i < r - 1) {
        const delayStep = base * (i + 1);
        await sleep(delayStep);
      }
    }

    wahaStructuredLog(name, 'QR_TIMEOUT', logExtra());
    return {
      success: true,
      state: 'PENDING',
      qr: null,
      format: null,
      provider: 'waha',
    };
  } finally {
    endWahaQrPoll(name);
  }
}

/**
 * Orquestrador central de preparação de sessão WAHA (locks provider+tenant+sessão, estados normalizados).
 * @param {string} name
 * @param {{ channelId?: string; tenantId?: string; correlationId?: string }} [ctx]
 */
export async function ensureSessionReady(name, ctx = {}) {
  const sessionName = resolveWahaRequestSession(name, ctx);
  assertWahaConfig();
  return ensureProviderSessionPrepared('waha', {
    sessionName,
    tenantId: ctx.tenantId ?? null,
    channelId: ctx.channelId ?? null,
    correlationId: ctx.correlationId ?? null,
  });
}

/**
 * @deprecated Uso interno / diagnóstico. Preferir normalizeProviderSessionStatus('waha', raw).
 */
export function normalizeWahaStatus(status) {
  return String(status ?? '')
    .trim()
    .toUpperCase()
    .replace(/-/g, '_');
}

/**
 * Garante que há conteúdo de QR utilizável antes de devolver sucesso ao cliente.
 */
function isValidQrPayload(qr) {
  if (qr == null) return false;

  if (typeof qr === 'string') {
    const s = qr.trim();
    if (!s) return false;
    return s.startsWith('data:image') || s.length > 100;
  }

  if (typeof qr === 'object') {
    if (qr.qr) return true;
    if (qr.base64) return true;
    if (qr.qrcode) return true;
    if (qr.code) return true;
  }

  return false;
}

/**
 * Health com cache (10s) via providerHealth.
 */
export async function checkWahaHealth() {
  return checkProviderHealth('waha');
}

export async function testWahaConnection() {
  return checkWahaHealth();
}

/**
 * @deprecated LEGADO — não usar em fluxos novos de conexão WhatsApp.
 * O caminho suportado é: `WahaProvider.connect` → `connectWahaChannel` (orquestrador) ou `ensureSessionReady`.
 * Mantido para compatibilidade (`services/providers/wahaProvider.js`, integrações antigas).
 * Remover após migrar todos os consumidores.
 *
 * @param {string} name
 * @param {{ channelId?: string; tenantId?: string; correlationId?: string }} [ctx]
 */
export async function createSession(name, ctx = {}) {
  const sessionName = resolveWahaRequestSession(name, ctx);
  whatsappLogger.warn('waha_legacy_createSession', {
    event: 'deprecated_api',
    session: sessionName,
    correlationId: ctx.correlationId ?? null,
    trace: new Error('legacy_createSession').stack?.split('\n').slice(1, 5).join(' | '),
  });
  logWahaContext(sessionName, ctx.channelId, ctx.tenantId);
  assertWahaConfig();

  await applyWahaFreeSessionResetIfNeeded({ correlationId: ctx.correlationId ?? null });

  try {
    await ensureSessionReady(sessionName, ctx);
    return { ok: true, data: { name: sessionName } };
  } catch (err) {
    const st = err.httpStatus ?? err.response?.status;
    if (st === 401) {
      return { ...wahaErr(err), httpStatus: 401 };
    }
    return wahaErr(err);
  }
}

/**
 * @param {string} name
 * @param {{ channelId?: string; tenantId?: string; correlationId?: string }} [ctx]
 */
export async function getQrCode(name, ctx = {}) {
  const correlationId =
    ctx.correlationId != null && String(ctx.correlationId).trim() !== ''
      ? String(ctx.correlationId).trim().slice(0, 128)
      : randomUUID();
  const ctxWithCid = { ...ctx, correlationId };
  const sessionName = resolveWahaRequestSession(name, ctxWithCid);
  const flowStarted = Date.now();
  const cidShort = String(correlationId).slice(0, 8);

  const finalize = (stateLabel, payload) => {
    const duration = Date.now() - flowStarted;
    recordTerminalQrMetrics(stateLabel);
    recordQrFlowDurationMs(duration);
    checkCriticalMetricsState();

    const s = String(stateLabel).toUpperCase();
    if (s === 'QR_AVAILABLE') {
      recordSuccessfulQrFlow();
    } else {
      resetConsecutiveQrSuccess();
    }

    console.log(`[WAHA][CID:${cidShort}][FINAL] state=${String(stateLabel)} duration=${duration}ms`);
    return payload;
  };

  logWahaContext(sessionName, ctxWithCid.channelId, ctxWithCid.tenantId, correlationId);
  assertWahaConfig();

  if (isCircuitOpen()) {
    const duration = Date.now() - flowStarted;
    recordQrFlowDurationMs(duration);
    checkCriticalMetricsState();
    resetConsecutiveQrSuccess();
    const unavailableUnified = buildUnifiedQrResponse({
      success: false,
      format: null,
      qr: null,
      session: sessionName,
      provider: 'waha',
      state: SessionState.UNAVAILABLE,
      source: null,
      error: 'WAHA temporarily disabled (circuit breaker)',
      correlationId,
      meta: { path: 'wahaService_circuit_open' },
    });
    console.log(`[WAHA][CID:${cidShort}][FINAL] state=UNAVAILABLE duration=${duration}ms`);
    return {
      ok: false,
      error: 'WAHA temporarily disabled (circuit breaker)',
      data: unavailableUnified,
      raw: unavailableUnified,
      ...unavailableUnified,
    };
  }

  await enforceWahaQrRateLimit(sessionName);

  const alive = await isWahaAlive();
  if (!alive) {
    trackOffline();
    const offlineUnified = buildUnifiedQrResponse({
      success: false,
      format: null,
      qr: null,
      session: sessionName,
      provider: 'waha',
      state: SessionState.OFFLINE,
      source: null,
      error: 'WAHA unavailable',
      correlationId,
      meta: { path: 'wahaService_waha_offline' },
    });
    return finalize(SessionState.OFFLINE, {
      ok: false,
      error: 'WAHA unavailable',
      data: offlineUnified,
      raw: offlineUnified,
      ...offlineUnified,
    });
  }

  return withWahaSessionLock(sessionName, async () => {
    const prep = await ensureSessionReady(sessionName, ctxWithCid);

    if (prep.state === SessionState.CONNECTED) {
      console.log(`[WAHA][CID:${cidShort}] Sessão já conectada após ensure — QR omitido`);
      const unified = buildUnifiedQrResponse({
        success: true,
        format: null,
        qr: null,
        session: sessionName,
        provider: 'waha',
        state: prep.state,
        source: null,
        error: null,
        correlationId,
        meta: { path: 'wahaService_after_ensure_connected', prepare: prep },
      });
      return finalize(SessionState.CONNECTED, {
        ok: true,
        alreadyConnected: true,
        data: unified,
        raw: unified,
        ...unified,
      });
    }

    const waited = await waitForWahaQr(sessionName, WAHA_QR_RETRIES, WAHA_QR_DELAY_MS, {
      skipHealthCheck: true,
      correlationId,
    });

    if (waited.state === 'CANCELLED') {
      const unified = buildUnifiedQrResponse({
        success: false,
        format: null,
        qr: null,
        session: sessionName,
        provider: 'waha',
        state: SessionState.CANCELLED,
        source: null,
        error: waited.error || 'QR polling superseded',
        correlationId,
        meta: { path: 'wahaService_qr_cancelled', prepare: prep },
      });
      return finalize(SessionState.CANCELLED, {
        ok: false,
        error: unified.error,
        data: unified,
        raw: unified,
        ...unified,
      });
    }

    if (waited.state === 'UNSTABLE') {
      const unified = buildUnifiedQrResponse({
        success: false,
        format: null,
        qr: null,
        session: sessionName,
        provider: 'waha',
        state: SessionState.UNSTABLE,
        source: null,
        error: waited.error || 'WAHA not responding properly',
        correlationId,
        meta: { path: 'wahaService_waha_unstable', prepare: prep },
      });
      return finalize(SessionState.UNSTABLE, {
        ok: false,
        error: unified.error,
        data: unified,
        raw: unified,
        ...unified,
      });
    }

    if (!waited.success && waited.state === 'OFFLINE') {
      const unified = buildUnifiedQrResponse({
        success: false,
        format: null,
        qr: null,
        session: sessionName,
        provider: 'waha',
        state: SessionState.OFFLINE,
        source: null,
        error: waited.error || 'WAHA temporarily unavailable',
        correlationId,
        meta: { path: 'wahaService_waha_offline_poll', prepare: prep },
      });
      return finalize(SessionState.OFFLINE, {
        ok: false,
        error: unified.error,
        data: unified,
        raw: unified,
        ...unified,
      });
    }

    if (waited.success && waited.qr) {
      const payload =
        extractQrPayload(waited.raw) ||
        extractQrPayload({ qr: waited.qr }) ||
        (typeof waited.qr === 'string' ? waited.qr.trim() : null);
      const dataUrl = toQrDataUrl(payload);
      if (dataUrl && isValidQrPayload(dataUrl)) {
        const n = normalizeQrResult(dataUrl);
        const fmt =
          waited.format === 'ascii'
            ? 'ascii'
            : waited.format === 'base64'
              ? 'base64'
              : n.format;
        const unified = buildUnifiedQrResponse({
          success: n.success,
          format: fmt ?? n.format,
          qr: n.qr,
          message: n.message,
          session: sessionName,
          provider: 'waha',
          state: SessionState.QR_AVAILABLE,
          source: 'rest',
          error: n.success ? null : n.message ?? 'QR inválido',
          correlationId,
          meta: { path: 'wahaService_waitForWahaQr', prepare: prep },
        });
        whatsappLogger.info('waha_qr_wait_success', {
          session: sessionName,
          correlationId,
        });
        return finalize(SessionState.QR_AVAILABLE, {
          ok: true,
          data: dataUrl,
          raw: waited.raw,
          ...unified,
        });
      }
    }

    const restDataUrl = await fetchWahaSessionQrcodeRest(sessionName, {
      correlationId,
    });
    if (restDataUrl && isValidQrPayload(restDataUrl)) {
      const n = normalizeQrResult(restDataUrl);
      const unified = buildUnifiedQrResponse({
        success: n.success,
        format: n.format,
        qr: n.qr,
        message: n.message,
        session: sessionName,
        provider: 'waha',
        state: SessionState.QR_AVAILABLE,
        source: 'rest',
        error: n.success ? null : n.message ?? 'QR inválido',
        correlationId,
        meta: { path: 'wahaService_rest_auth_qr_fallback', prepare: prep },
      });
      return finalize(SessionState.QR_AVAILABLE, {
        ok: true,
        data: restDataUrl,
        raw: restDataUrl,
        ...unified,
      });
    }

    const maxQrAttempts = 30;
    for (let attempt = 0; attempt < maxQrAttempts; attempt++) {
      const qr = getCurrentQr();
      if (qr && isValidQrPayload(qr)) {
        const n = normalizeQrResult(qr);
        const unified = buildUnifiedQrResponse({
          success: n.success,
          format: n.format,
          qr: n.qr,
          message: n.message,
          session: sessionName,
          provider: 'waha',
          state: SessionState.QR_AVAILABLE,
          source: 'logs',
          error: n.success ? null : n.message ?? 'QR inválido',
          correlationId,
          meta: { path: 'wahaService_log_capture', prepare: prep, attempts: attempt + 1 },
        });
        whatsappLogger.info('waha_qr_log_capture', {
          session: sessionName,
          attempts: attempt + 1,
          correlationId,
        });
        return finalize(SessionState.QR_AVAILABLE, {
          ok: true,
          data: qr,
          raw: qr,
          ...unified,
        });
      }
      if (isWahaQrPollDebug()) {
        console.log(`[WAHA][CID:${cidShort}] Aguardando QR nos logs do container…`, {
          attempt: attempt + 1,
          max: maxQrAttempts,
          session: sessionName,
        });
      }
      if (attempt < maxQrAttempts - 1) {
        await sleep(1000);
      }
    }

    whatsappLogger.warn('waha_qr_poll_exhausted_pending', {
      session: sessionName,
      attempts: maxQrAttempts,
      correlationId,
    });

    const pendingUnified = buildUnifiedQrResponse({
      success: true,
      format: null,
      qr: null,
      session: sessionName,
      provider: 'waha',
      state: SessionState.PENDING,
      source: 'logs',
      error: null,
      correlationId,
      meta: { path: 'wahaService_qr_pending_poll', prepare: prep },
    });

    return finalize(SessionState.PENDING, {
      ok: true,
      pending: true,
      data: pendingUnified,
      raw: pendingUnified,
      ...pendingUnified,
    });
  });
}

/**
 * Camada interna com retorno estruturado (sem throw) — preferir em fluxos novos; {@link getQrCode} mantém throw por compat.
 *
 * @param {string} name
 * @param {{ channelId?: string; tenantId?: string; correlationId?: string }} [ctx]
 * @returns {Promise<{ ok: true, data: object } | { ok: false, error: string, code?: string, correlationId?: string|null }>}
 */
export async function getQrCodeOperationResult(name, ctx = {}) {
  try {
    const data = await getQrCode(name, ctx);
    const resolvedCid = data?.correlationId ?? ctx.correlationId ?? null;
    if (data && data.ok === false) {
      return {
        ok: false,
        error: data.error ?? data.message ?? 'WAHA indisponível',
        code: data.code,
        correlationId: resolvedCid,
        data,
      };
    }
    return { ok: true, data, correlationId: resolvedCid };
  } catch (e) {
    return {
      ok: false,
      error: e?.message || 'QR não disponível',
      code: e?.code,
      correlationId: ctx.correlationId ?? null,
    };
  }
}

export async function getSessionStatus(name, ctx = {}) {
  const sessionName = resolveWahaRequestSession(name, ctx);
  logWahaContext(sessionName, ctx.channelId, ctx.tenantId);
  assertWahaConfig();
  try {
    const data = await wahaRequest('GET', `/api/sessions/${encodeURIComponent(sessionName)}`);
    return { ok: true, data };
  } catch (err) {
    return { ...wahaErr(err), data: null };
  }
}

export async function sendMessage(name, number, text, ctx = {}) {
  const sessionName = resolveWahaRequestSession(name, ctx);
  console.log('[WAHA] Session:', sessionName);
  const digits = String(number || '').replace(/\D/g, '');
  const body = {
    session: sessionName,
    chatId: `${digits}@c.us`,
    text: String(text ?? ''),
  };
  console.log('[WAHA] Sending message', { session: sessionName, chatId: body.chatId });
  assertWahaConfig();
  try {
    const data = await wahaRequest('POST', '/api/sendText', body);
    return { ok: true, data };
  } catch (err) {
    return wahaErr(err);
  }
}

export async function logoutSession(name, ctx = {}) {
  const sessionName = resolveWahaRequestSession(name, ctx);
  console.log('[WAHA] Session:', sessionName);
  assertWahaConfig();
  try {
    await wahaRequest('POST', `/api/sessions/${encodeURIComponent(sessionName)}/logout`, {});
    return { ok: true };
  } catch (err) {
    console.warn('[WAHA] logoutSession:', err.message);
    return wahaErr(err);
  }
}

export async function deleteSession(name, ctx = {}) {
  const sessionName = resolveWahaRequestSession(name, ctx);
  console.log('[WAHA] Session:', sessionName);
  assertWahaConfig();
  try {
    await wahaRequest('DELETE', `/api/sessions/${encodeURIComponent(sessionName)}`);
    return { ok: true };
  } catch (err) {
    const st = err.httpStatus ?? err.response?.status;
    if (st === 404) return { ok: true, missing: true };
    console.warn('[WAHA] deleteSession:', err.message);
    return wahaErr(err);
  }
}

export async function setWebhook(name, ctx = {}) {
  const sessionName = resolveWahaRequestSession(name, ctx);
  console.log('[WAHA] Session:', sessionName);
  const apiUrl = (process.env.API_URL || '').trim();
  if (!apiUrl) {
    console.warn('[WAHA] API_URL não definido — webhook pode falhar');
  }
  const webhookUrl = `${(apiUrl || 'https://api.omnia1biai.com.br').replace(/\/$/, '')}/api/channels/webhook/waha`;
  console.log('[WAHA] Configuring webhook', { session: sessionName, webhookUrl });

  const body = {
    name: sessionName,
    config: {
      webhooks: [
        {
          url: webhookUrl,
          events: ['message', 'session.status'],
        },
      ],
    },
  };

  assertWahaConfig();
  try {
    const data = await wahaRequest('PUT', `/api/sessions/${encodeURIComponent(sessionName)}`, body);
    return { ok: true, data };
  } catch (err) {
    try {
      const data = await wahaRequest('PUT', `/api/sessions/${encodeURIComponent(sessionName)}/`, body);
      return { ok: true, data };
    } catch (err2) {
      return wahaErr(err2);
    }
  }
}

export function isWahaUnreachableError(err) {
  const c = err?.code;
  if (c === 'WAHA_UNREACHABLE') return true;
  return c === 'ECONNREFUSED' || c === 'ENOTFOUND' || c === 'ETIMEDOUT';
}

export function isWahaUnauthorizedResult(result) {
  return result && result.ok === false && (result.httpStatus === 401 || result.code === 'UNAUTHORIZED');
}

/** URL resolvida (somente leitura, para diagnóstico). */
export function getResolvedWahaUrl() {
  assertWahaConfig();
  return (config.providers.waha.url || WAHA_URL_RESOLVED).replace(/\/$/, '');
}
