/**
 * Cliente WAHA — HTTP via wahaHttp (x-api-key, WAHA_API_URL / WAHA_API_KEY).
 */

import { config } from '../config/env.js';
import { checkProviderHealth } from './providerHealth.service.js';
import { wahaRequest, validateWahaEnv } from './wahaHttp.js';
import { resolveWahaSessionName, WAHA_CORE_DEFAULT_SESSION } from '../utils/wahaSession.util.js';

export { resolveSessionName } from '../utils/resolveSessionName.js';
export { resolveWahaSessionName, WAHA_CORE_DEFAULT_SESSION } from '../utils/wahaSession.util.js';

const WAHA_URL_RESOLVED = (process.env.WAHA_API_URL || process.env.WAHA_URL || '').trim();

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

function extractSessionsArray(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.sessions)) return raw.sessions;
  if (raw && Array.isArray(raw.data)) return raw.data;
  if (raw && Array.isArray(raw.items)) return raw.items;
  return [];
}

function sessionNameMatches(entry, sessionName) {
  const want = String(sessionName).trim();
  if (entry == null) return false;
  if (typeof entry === 'string') return entry.trim() === want;
  if (typeof entry === 'object') {
    const n = entry.name ?? entry.session ?? entry.id;
    return n != null && String(n).trim() === want;
  }
  return false;
}

function normalizeWahaStatus(status) {
  return String(status ?? '')
    .trim()
    .toUpperCase()
    .replace(/-/g, '_');
}

/** Estados em que o endpoint de QR costuma responder com payload válido (≠ conectado). */
function isSessionReadyForQr(status) {
  const normalized = normalizeWahaStatus(status);
  return normalized === 'SCAN_QR_CODE' || normalized === 'STARTED';
}

function isSessionConnected(status) {
  return normalizeWahaStatus(status) === 'CONNECTED';
}

function extractStatusFromSessionEntry(entry) {
  if (entry == null || typeof entry !== 'object') return null;
  return (
    entry.status ??
    entry.state ??
    entry.session?.status ??
    entry.connectionStatus ??
    entry.me?.status ??
    null
  );
}

/**
 * Snapshot da sessão na API (lista global ou GET por nome), com status para decisão de QR.
 */
async function getSessionSnapshot(sessionName) {
  try {
    const raw = await wahaRequest('GET', '/api/sessions');
    const list = extractSessionsArray(raw);
    const session = list.find((s) => sessionNameMatches(s, sessionName));
    if (session && typeof session === 'object') {
      const status = extractStatusFromSessionEntry(session);
      return { found: true, session, status };
    }
  } catch {
    /* tenta GET direto */
  }
  try {
    const data = await wahaRequest('GET', `/api/sessions/${encodeURIComponent(sessionName)}`);
    const session = typeof data === 'object' && data != null ? data : null;
    const status = extractStatusFromSessionEntry(session);
    return { found: true, session, status };
  } catch (err) {
    const st = err.httpStatus ?? err.response?.status;
    if (st === 404) return { found: false, session: null, status: null };
    throw err;
  }
}

/**
 * Aguarda sessão existir e estar pronta para QR ou já conectada (FREE após create/reset).
 */
async function waitForSessionReady(sessionName) {
  const maxAttempts = 10;
  const delayMs = 1000;

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const { found, session, status } = await getSessionSnapshot(sessionName);
      if (session && typeof session === 'object') {
        console.log('[WAHA] Session status:', session.status ?? status);
      }

      const effectiveStatus = extractStatusFromSessionEntry(session) ?? status;
      const readyForQr = found && isSessionReadyForQr(effectiveStatus);
      const connected = found && isSessionConnected(effectiveStatus);
      if (readyForQr || connected) {
        console.log('[WAHA] Session ready:', sessionName, 'status:', effectiveStatus);
        return true;
      }
    } catch {
      console.log('[WAHA] Waiting session...');
    }

    console.log('[WAHA] Waiting for session...');
    await new Promise((r) => setTimeout(r, delayMs));
  }

  throw new Error('WAHA session not ready in time');
}

function sleepMs(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
 * @param {string} name
 * @param {{ channelId?: string; tenantId?: string }} [ctx]
 */
export async function createSession(name, ctx = {}) {
  const sessionName = resolveWahaRequestSession(name, ctx);
  logWahaContext(sessionName, ctx.channelId, ctx.tenantId);
  assertWahaConfig();

  if (process.env.WAHA_MULTI_SESSION !== 'true') {
    try {
      console.log('[WAHA] Resetting default session (FREE mode)');
      await wahaRequest(
        'DELETE',
        `/api/sessions/${encodeURIComponent(WAHA_CORE_DEFAULT_SESSION)}`,
      );
    } catch {
      console.log('[WAHA] No previous session to delete or already clean');
    }
  }

  console.log('[WAHA] Creating session:', sessionName);

  try {
    const data = await wahaRequest('POST', '/api/sessions', {
      name: sessionName,
      start: true,
    });
    return { ok: true, data };
  } catch (err) {
    const st = err.httpStatus ?? err.response?.status;
    if (st === 401) {
      return { ...wahaErr(err), httpStatus: 401 };
    }
    if (st === 409 || st === 400) {
      try {
        await wahaRequest('POST', `/api/sessions/${encodeURIComponent(sessionName)}/start`, {});
        return { ok: true, data: { name: sessionName, reused: true } };
      } catch (e2) {
        try {
          await wahaRequest('POST', '/api/sessions/start', { name: sessionName });
          return { ok: true, data: { name: sessionName, reused: true } };
        } catch (e3) {
          try {
            await wahaRequest('POST', '/api/sessions/start', { session: sessionName });
            return { ok: true, data: { name: sessionName, reused: true } };
          } catch (e4) {
            return wahaErr(e4);
          }
        }
      }
    }
    return wahaErr(err);
  }
}

/**
 * @param {string} name
 * @param {{ channelId?: string; tenantId?: string }} [ctx]
 */
export async function getQrCode(name, ctx = {}) {
  const sessionName = resolveWahaRequestSession(name, ctx);
  logWahaContext(sessionName, ctx.channelId, ctx.tenantId);
  assertWahaConfig();

  const returnIfAlreadyConnected = async () => {
    try {
      const { found, session, status } = await getSessionSnapshot(sessionName);
      if (!found) return null;
      const st = extractStatusFromSessionEntry(session) ?? status;
      if (isSessionConnected(st)) {
        console.log('[WAHA] Session already connected, skipping QR');
        console.log('[WAHA] Session already connected');
        return { ok: true, alreadyConnected: true };
      }
    } catch {
      /* segue fluxo normal */
    }
    return null;
  };

  let skipQr = await returnIfAlreadyConnected();
  if (skipQr) return skipQr;

  if (process.env.WAHA_MULTI_SESSION !== 'true') {
    await waitForSessionReady(sessionName);
  }

  skipQr = await returnIfAlreadyConnected();
  if (skipQr) return skipQr;

  const paths = [
    `/api/${encodeURIComponent(sessionName)}/auth/qr`,
    `/api/sessions/${encodeURIComponent(sessionName)}/qr`,
    `/api/sessions/${encodeURIComponent(sessionName)}/qrcode`,
    `/api/sessions/${encodeURIComponent(sessionName)}/qr-code`,
  ];
  const maxQrAttempts = 5;
  let lastErr;

  for (const path of paths) {
    for (let attempt = 0; attempt < maxQrAttempts; attempt++) {
      try {
        console.log('[WAHA] Fetching QR...');
        const data = await wahaRequest('GET', path);
        const raw = data?.qr ?? data?.base64 ?? data?.qrcode ?? data;

        if (isValidQrPayload(data) || isValidQrPayload(raw)) {
          console.log('[WAHA] QR ready');
          return { ok: true, data: raw, raw: data };
        }

        console.log('[WAHA] QR not ready yet...');
        console.log('[WAHA] QR not ready yet, retrying...');
      } catch (err) {
        lastErr = err;
        const st = err.httpStatus ?? err.response?.status;
        if (st === 401) {
          return { ...wahaErr(err), raw: null };
        }
        if (st === 404) {
          break;
        }
        if (st === 422) {
          console.log('[WAHA] QR not ready yet...');
          console.log('[WAHA] QR not ready yet, retrying...');
        } else if (st) {
          return { ...wahaErr(err), raw: null };
        } else {
          console.log('[WAHA] QR not ready yet...');
          console.log('[WAHA] QR not ready yet, retrying...');
        }
      }

      if (attempt < maxQrAttempts - 1) {
        await sleepMs(1000);
      }
    }
  }

  console.error('[WAHA ERROR]', 'QR não disponível', lastErr?.message || '');
  throw new Error('QR não disponível');
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
