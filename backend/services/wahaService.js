/**
 * Cliente HTTP WAHA — usa config central (config/providers.waha), sem URLs hardcoded.
 */

import axios from 'axios';
import { config } from '../config/env.js';
import { checkProviderHealth } from './providerHealth.service.js';

export { resolveSessionName, resolveSessionName as resolveWahaSessionName } from '../utils/resolveSessionName.js';

/** @type {import('axios').AxiosInstance | null} */
let _api = null;

function assertWahaConfig() {
  const w = config.providers?.waha;
  if (!w?.url?.trim()) throw new Error('WAHA_API_URL não configurado');
  if (!w?.apiKey?.trim()) throw new Error('WAHA_API_KEY não configurado');
}

function buildWahaAxios() {
  assertWahaConfig();
  const w = config.providers.waha;
  const baseURL = w.url.replace(/\/$/, '');
  const timeout = w.requestTimeoutMs ?? 5000;
  return axios.create({
    baseURL,
    timeout,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Api-Key': w.apiKey,
    },
  });
}

function getApi() {
  assertWahaConfig();
  if (!_api) {
    _api = buildWahaAxios();
    _api.interceptors.request.use((req) => {
      const w = config.providers.waha;
      req.baseURL = w.url.replace(/\/$/, '');
      req.headers = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Api-Key': w.apiKey,
        ...req.headers,
      };
      const method = (req.method || 'get').toUpperCase();
      console.log(`[WAHA] Request → ${method} ${req.url}`);
      return req;
    });
    _api.interceptors.response.use(
      (response) => {
        console.log(`[WAHA] Response OK ${response.config?.url || ''}`);
        return response;
      },
      (err) => {
        console.error('[WAHA ERROR]:', err.response?.data || err.message);
        return Promise.reject(err);
      }
    );
  }
  return _api;
}

function wahaErr(err) {
  const st = err.response?.status;
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
  console.log('[WAHA] URL:', config.providers.waha.url);
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
  const api = getApi();
  try {
    const { data } = await api.post('/api/sessions', {
      name: sessionName,
      start: true,
    });
    return { ok: true, data };
  } catch (err) {
    const st = err.response?.status;
    if (st === 401) {
      return { ...wahaErr(err), httpStatus: 401 };
    }
    if (st === 409 || st === 400) {
      try {
        await api.post(`/api/sessions/${encodeURIComponent(sessionName)}/start`, {});
        return { ok: true, data: { name: sessionName, reused: true } };
      } catch (e2) {
        try {
          await api.post('/api/sessions/start', { name: sessionName });
          return { ok: true, data: { name: sessionName, reused: true } };
        } catch (e3) {
          try {
            await api.post('/api/sessions/start', { session: sessionName });
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
  const api = getApi();
  const paths = [
    `/api/${encodeURIComponent(sessionName)}/auth/qr`,
    `/api/sessions/${encodeURIComponent(sessionName)}/qr`,
    `/api/sessions/${encodeURIComponent(sessionName)}/qrcode`,
    `/api/sessions/${encodeURIComponent(sessionName)}/qr-code`,
  ];
  let lastErr;
  for (const path of paths) {
    try {
      const { data } = await api.get(path);
      const raw = data?.qr ?? data?.base64 ?? data?.qrcode ?? data;
      return { ok: true, data: raw, raw: data };
    } catch (err) {
      lastErr = err;
      const st = err.response?.status;
      if (st && st !== 404) {
        return { ...wahaErr(err), raw: null };
      }
    }
  }
  console.error('[WAHA ERROR]:', 'QR não disponível', lastErr?.response?.data || lastErr?.message);
  throw new Error('QR não disponível');
}

export async function getSessionStatus(name) {
  const sessionName = normalizeSessionName(name);
  const api = getApi();
  try {
    const { data } = await api.get(`/api/sessions/${encodeURIComponent(sessionName)}`);
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
  const api = getApi();
  try {
    const { data } = await api.post('/api/sendText', body);
    return { ok: true, data };
  } catch (err) {
    return wahaErr(err);
  }
}

export async function logoutSession(name) {
  const sessionName = normalizeSessionName(name);
  const api = getApi();
  try {
    await api.post(`/api/sessions/${encodeURIComponent(sessionName)}/logout`, {});
    return { ok: true };
  } catch (err) {
    console.warn('[WAHA] logoutSession:', err.message);
    return wahaErr(err);
  }
}

export async function deleteSession(name) {
  const sessionName = normalizeSessionName(name);
  const api = getApi();
  try {
    await api.delete(`/api/sessions/${encodeURIComponent(sessionName)}`);
    return { ok: true };
  } catch (err) {
    if (err.response?.status === 404) return { ok: true, missing: true };
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

  const api = getApi();
  try {
    const { data } = await api.put(`/api/sessions/${encodeURIComponent(sessionName)}`, body);
    return { ok: true, data };
  } catch (err) {
    try {
      const { data } = await api.put(`/api/sessions/${encodeURIComponent(sessionName)}/`, body);
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
  return config.providers.waha.url.replace(/\/$/, '');
}
