/**
 * Cliente HTTP único para WAHA — WAHA_API_URL / WAHA_URL / WAHA_BASE_URL e WAHA_API_KEY.
 * Headers de auth: {@link ./providerAuthResolver.js} (x-api-key, apikey SIMPLE ou key CORE).
 */

import axios from 'axios';
import { extractQrPayload, toQrDataUrl } from '../utils/extractQrPayload.js';
import { getCurrentQr } from './wahaQrCapture.js';
import { resolveProviderAuth } from './providerAuthResolver.js';

export { resolveWahaSessionName, WAHA_CORE_DEFAULT_SESSION } from '../utils/wahaSession.util.js';

const WAHA_API_URL = (
  process.env.WAHA_API_URL ||
  process.env.WAHA_URL ||
  process.env.WAHA_BASE_URL ||
  ''
).trim();
const WAHA_API_KEY = (process.env.WAHA_API_KEY || '').trim();

function timeoutMs() {
  const n = parseInt(process.env.WAHA_REQUEST_TIMEOUT_MS || '15000', 10);
  return Number.isFinite(n) && n > 0 ? n : 15000;
}

export function validateWahaEnv() {
  if (!WAHA_API_URL || !WAHA_API_KEY) {
    throw new Error('WAHA não configurado no ambiente');
  }
}

/**
 * @param {string} method
 * @param {string} path - ex.: "/api/sessions"
 * @param {object|null} [data]
 * @returns {Promise<any>} response.data
 */
export async function wahaRequest(method, path, data = null) {
  validateWahaEnv();

  const base = WAHA_API_URL.replace(/\/$/, '');
  const pathStr = String(path || '').startsWith('/') ? path : `/${path}`;
  const url = `${base}${pathStr}`;
  const methodUpper = String(method || 'GET').toUpperCase();

  console.log('[WAHA] Request:', methodUpper, url);

  try {
    const { headers: authHeaders } = await resolveProviderAuth('waha');
    const cfg = {
      method: methodUpper,
      url,
      headers: {
        ...authHeaders,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      timeout: timeoutMs(),
    };
    if (data != null && methodUpper !== 'GET' && methodUpper !== 'HEAD') {
      cfg.data = data;
    }
    const response = await axios(cfg);
    return response.data;
  } catch (error) {
    if (error.response) {
      const status = error.response.status;
      let msg;
      if (status === 401) {
        msg = 'WAHA authentication failed: API key inválida ou ausente';
      } else {
        const body = error.response.data;
        const detail = typeof body === 'string' ? body : JSON.stringify(body ?? {});
        msg = `WAHA ERROR ${status}: ${detail}`;
      }
      console.error('[WAHA ERROR]', msg);
      const err = new Error(msg);
      err.httpStatus = status;
      err.responseData = error.response.data;
      throw err;
    }
    const msg = `WAHA CONNECTION ERROR: ${error.message}`;
    console.error('[WAHA ERROR]', msg);
    const err = new Error(msg);
    err.code = error.code;
    throw err;
  }
}

/**
 * Obtém imagem QR da sessão via REST (GET /api/sessions/:name/qrcode ou /qr).
 * Usa WAHA_API_URL (ex.: http://saas_waha:3000) e header x-api-key.
 * @param {string} sessionName
 * @returns {Promise<string|null>} data URL ou null se indisponível / rota inexistente
 */
export async function fetchWahaSessionQrcodeRest(sessionName) {
  try {
    validateWahaEnv();
  } catch {
    return null;
  }
  const name = String(sessionName ?? 'default').trim() || 'default';
  const enc = encodeURIComponent(name);
  const paths = [`/api/sessions/${enc}/qrcode`, `/api/sessions/${enc}/qr`];
  for (const path of paths) {
    try {
      const data = await wahaRequest('GET', path);
      const raw = data?.qr ?? data?.data ?? data?.base64 ?? data?.qrcode ?? data;
      const payload =
        extractQrPayload(data) ||
        extractQrPayload(raw) ||
        (typeof raw === 'string' && raw.trim() ? raw.trim() : null);
      const url = toQrDataUrl(payload);
      if (url) {
        console.log('[WAHA] QR obtido via REST', path);
        return url;
      }
    } catch (e) {
      const st = e.httpStatus ?? e.response?.status;
      if (st === 401) {
        console.warn('[WAHA] QR REST não autorizado');
        return null;
      }
      if (st === 404) {
        continue;
      }
    }
  }
  return null;
}

export const wahaProvider = {
  getSessions: () => {
    console.log('[WAHA] Session:', '(getSessions — lista)');
    return wahaRequest('GET', '/api/sessions');
  },

  createSession: (sessionName) => {
    console.log('[WAHA] Session:', sessionName);
    return wahaRequest('POST', '/api/sessions', {
      name: sessionName,
      start: true,
    });
  },

  getQrCode: (sessionName) => {
    console.log('[WAHA] QR (captura de logs):', sessionName);
    const qr = getCurrentQr();
    return Promise.resolve(qr ?? null);
  },
};
