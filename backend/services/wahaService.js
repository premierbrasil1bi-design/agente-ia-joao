/**
 * Cliente WAHA — HTTP via wahaHttp (x-api-key, WAHA_API_URL / WAHA_API_KEY).
 *
 * Fluxo de sessão (produção):
 * - Preparação idempotente: whatsappSessionOrchestrator.ensureWahaSessionPrepared (via ensureSessionReady).
 * - Connect do provider: whatsappSessionOrchestrator.connectWahaChannel (health + FREE reset opcional + ensure).
 * - createSession: apenas FREE reset + ensure (compat legado; não duplicar após connect do provider).
 * - Estados normalizados: whatsapp/whatsappSessionState (agnóstico); WAHA mapeado em normalizeProviderSessionStatus.
 */

import { config } from '../config/env.js';
import { checkProviderHealth } from './providerHealth.service.js';
import { wahaRequest, validateWahaEnv } from './wahaHttp.js';
import { getCurrentQr } from './wahaQrCapture.js';
import { resolveWahaSessionName, WAHA_CORE_DEFAULT_SESSION } from '../utils/wahaSession.util.js';
import { applyWahaFreeSessionResetIfNeeded } from './whatsappSessionOrchestrator.service.js';
import { ensureProviderSessionPrepared } from './whatsappSessionProvider.facade.js';
import { whatsappLogger } from './whatsapp/whatsappSessionLogger.js';
import { SessionState } from './whatsapp/whatsappSessionState.js';
import { buildUnifiedQrResponse } from '../utils/whatsappQrContract.js';
import { normalizeQrResult } from '../utils/normalizeQrResult.js';

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
      ? 'WAHA: não autorizado (verifique WAHA_API_KEY).'
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

function logWahaContext(sessionName, channelId, tenantId) {
  console.log('[WAHA] URL:', config.providers.waha.url || process.env.WAHA_API_URL);
  console.log('[WAHA] Session:', sessionName);
  console.log('[WAHA] PROVIDER:', 'waha');
  if (channelId != null) console.log('[WAHA] channelId:', channelId);
  if (tenantId != null) console.log('[WAHA] tenantId:', tenantId);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isWahaQrPollDebug() {
  const v = String(process.env.WAHA_SESSION_DEBUG_POLL || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
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
  const sessionName = resolveWahaRequestSession(name, ctx);
  logWahaContext(sessionName, ctx.channelId, ctx.tenantId);
  assertWahaConfig();

  const prep = await ensureSessionReady(sessionName, ctx);

  if (prep.state === SessionState.CONNECTED) {
    console.log('[WAHA] Sessão já conectada após ensure — QR omitido');
    const unified = buildUnifiedQrResponse({
      success: true,
      format: null,
      qr: null,
      session: sessionName,
      provider: 'waha',
      state: prep.state,
      source: null,
      error: null,
      correlationId: ctx.correlationId ?? null,
      meta: { path: 'wahaService_after_ensure_connected', prepare: prep },
    });
    return {
      ok: true,
      alreadyConnected: true,
      data: unified,
      raw: unified,
      ...unified,
    };
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
        correlationId: ctx.correlationId ?? null,
        meta: { path: 'wahaService_log_capture', prepare: prep, attempts: attempt + 1 },
      });
      whatsappLogger.info('waha_qr_log_capture', {
        session: sessionName,
        attempts: attempt + 1,
        correlationId: ctx.correlationId ?? null,
      });
      return {
        ok: true,
        data: qr,
        raw: qr,
        ...unified,
      };
    }
    if (isWahaQrPollDebug()) {
      console.log('[WAHA] Aguardando QR nos logs do container…', {
        attempt: attempt + 1,
        max: maxQrAttempts,
        session: sessionName,
      });
    }
    if (attempt < maxQrAttempts - 1) {
      await sleep(1000);
    }
  }

  whatsappLogger.error('waha_qr_poll_exhausted', {
    session: sessionName,
    attempts: maxQrAttempts,
    correlationId: ctx.correlationId ?? null,
  });
  throw new Error('QR não disponível');
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
    return { ok: true, data };
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
