/**
 * Cliente WAHA — HTTP via wahaHttp (x-api-key, WAHA_API_URL / WAHA_API_KEY).
 */

import { config } from '../config/env.js';
import { checkProviderHealth } from './providerHealth.service.js';
import { wahaRequest, validateWahaEnv } from './wahaHttp.js';

export { resolveSessionName, resolveSessionName as resolveWahaSessionName } from '../utils/resolveSessionName.js';

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

function logWahaContext(sessionName, channelId, tenantId) {
  console.log('[WAHA] URL:', config.providers.waha.url || process.env.WAHA_API_URL);
  console.log('[WAHA] SESSION:', sessionName);
  console.log('[WAHA] PROVIDER:', 'waha');
  if (channelId != null) console.log('[WAHA] channelId:', channelId);
  if (tenantId != null) console.log('[WAHA] tenantId:', tenantId);
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
  const sessionName = normalizeSessionName(name);
  logWahaContext(sessionName, ctx.channelId, ctx.tenantId);
  assertWahaConfig();
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
  const sessionName = normalizeSessionName(name);
  logWahaContext(sessionName, ctx.channelId, ctx.tenantId);
  assertWahaConfig();
  const paths = [
    `/api/${encodeURIComponent(sessionName)}/auth/qr`,
    `/api/sessions/${encodeURIComponent(sessionName)}/qr`,
    `/api/sessions/${encodeURIComponent(sessionName)}/qrcode`,
    `/api/sessions/${encodeURIComponent(sessionName)}/qr-code`,
  ];
  let lastErr;
  for (const path of paths) {
    try {
      const data = await wahaRequest('GET', path);
      const raw = data?.qr ?? data?.base64 ?? data?.qrcode ?? data;
      return { ok: true, data: raw, raw: data };
    } catch (err) {
      lastErr = err;
      const st = err.httpStatus ?? err.response?.status;
      if (st === 401) {
        return { ...wahaErr(err), raw: null };
      }
      if (st && st !== 404) {
        return { ...wahaErr(err), raw: null };
      }
    }
  }
  console.error('[WAHA ERROR]', 'QR não disponível', lastErr?.message || '');
  throw new Error('QR não disponível');
}

export async function getSessionStatus(name) {
  const sessionName = normalizeSessionName(name);
  assertWahaConfig();
  try {
    const data = await wahaRequest('GET', `/api/sessions/${encodeURIComponent(sessionName)}`);
    return { ok: true, data };
  } catch (err) {
    return { ...wahaErr(err), data: null };
  }
}

export async function sendMessage(name, number, text) {
  const sessionName = normalizeSessionName(name);
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

export async function logoutSession(name) {
  const sessionName = normalizeSessionName(name);
  assertWahaConfig();
  try {
    await wahaRequest('POST', `/api/sessions/${encodeURIComponent(sessionName)}/logout`, {});
    return { ok: true };
  } catch (err) {
    console.warn('[WAHA] logoutSession:', err.message);
    return wahaErr(err);
  }
}

export async function deleteSession(name) {
  const sessionName = normalizeSessionName(name);
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

export async function setWebhook(name) {
  const sessionName = normalizeSessionName(name);
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
