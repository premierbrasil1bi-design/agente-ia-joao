/**
 * Cliente HTTP único para WAHA — WAHA_API_URL / WAHA_URL / WAHA_BASE_URL.
 * Autenticação obrigatória via header `apikey` em todas as requisições.
 */

import axios from 'axios';
import { extractQrPayload, toQrDataUrl } from '../utils/extractQrPayload.js';
import { getCurrentQr } from './wahaQrCapture.js';
import { withTimeout } from '../utils/withTimeout.js';
import { SessionOpErrorCode } from './whatsapp/whatsappSessionErrors.js';
import { withWahaTimeout, WAHA_GLOBAL_TIMEOUT_MS } from './whatsapp/wahaHardening.js';

export { resolveWahaSessionName, WAHA_CORE_DEFAULT_SESSION } from '../utils/wahaSession.util.js';

const WAHA_BASE_URL = (
  process.env.WAHA_API_URL ||
  process.env.WAHA_URL ||
  process.env.WAHA_BASE_URL ||
  ''
).trim();

console.log('[WAHA] API KEY definida:', !!process.env.WAHA_API_KEY);

function timeoutMs() {
  const n = parseInt(process.env.WAHA_REQUEST_TIMEOUT_MS || '15000', 10);
  return Number.isFinite(n) && n > 0 ? n : 15000;
}

export function validateWahaEnv() {
  if (!WAHA_BASE_URL) {
    throw new Error('WAHA não configurado no ambiente (defina WAHA_API_URL)');
  }
}

const wahaClient = axios.create({
  baseURL: WAHA_BASE_URL,
  timeout: 10000,
  headers: {
    apikey: process.env.WAHA_API_KEY,
  },
});

wahaClient.interceptors.request.use((cfg) => {
  cfg.headers = {
    ...(cfg.headers || {}),
    apikey: process.env.WAHA_API_KEY,
  };
  return cfg;
});

/**
 * Health rápido: GET /api/sessions (sem auth; usa WAHA_API_URL).
 * @returns {Promise<boolean>}
 */
export async function isWahaAlive() {
  if (!WAHA_BASE_URL) return false;
  const healthMs = Math.min(5000, WAHA_GLOBAL_TIMEOUT_MS);
  try {
    const r = await withWahaTimeout(
      wahaClient.get('/api/sessions', {
        headers: { Accept: 'application/json' },
        timeout: healthMs,
        validateStatus: (s) => s >= 200 && s < 500,
      }),
      healthMs,
    );
    if (r.status >= 200 && r.status < 300) return true;
    return false;
  } catch {
    console.log('[WAHA] Health check failed');
    return false;
  }
}

/**
 * @param {string} sessionName
 */
export async function wahaPostStartSession(sessionName) {
  const enc = encodeURIComponent(String(sessionName || '').trim());
  try {
    await wahaRequest('POST', `/api/sessions/${enc}/start`, {});
  } catch (e1) {
    const st = e1.httpStatus ?? e1.response?.status;
    if (st === 404) {
      try {
        await wahaRequest('POST', '/api/sessions/start', { name: sessionName });
      } catch {
        await wahaRequest('POST', '/api/sessions/start', { session: sessionName });
      }
    } else {
      throw e1;
    }
  }
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

/**
 * Garante sessão listada no WAHA, cria se faltar e inicia.
 * @param {string} [session]
 */
export async function ensureWahaSession(session = 'default') {
  const name = String(session ?? 'default').trim() || 'default';
  validateWahaEnv();
  console.log('[WAHA] Session check', name);

  const rawList = await wahaRequest('GET', '/api/sessions');
  const list = extractSessionsArray(rawList);
  const exists = list.some((e) => sessionNameMatches(e, name));

  if (!exists) {
    console.log('[WAHA] Session created', name);
    try {
      await wahaRequest('POST', '/api/sessions', { name });
    } catch (err) {
      const st = err.httpStatus ?? err.response?.status;
      if (st !== 409 && st !== 400) throw err;
    }
  }

  try {
    await wahaPostStartSession(name);
    console.log('[WAHA] Session started', name);
  } catch (err) {
    console.log('[WAHA] Session start ignored (possibly already started)', err?.message || err);
  }
}

/**
 * QR via rota auth (devlikeapro/waha atual).
 * @param {string} [session]
 * @param {{ quiet?: boolean }} [opts]
 */
export async function getWahaQr(session = 'default', opts = {}) {
  const quiet = Boolean(opts.quiet);
  const name = String(session ?? 'default').trim() || 'default';
  validateWahaEnv();
  const enc = encodeURIComponent(name);
  if (!quiet) console.log('[WAHA] QR requested', name);
  try {
    const data = await wahaRequest('GET', `/api/${enc}/auth/qr`);
    const qr = data?.qr ?? null;
    if (!quiet) {
      if (qr) console.log('[WAHA] QR READY');
      else console.log('[WAHA] QR pending');
    }
    return {
      success: true,
      qr: qr || null,
      raw: data,
    };
  } catch (e) {
    if (!quiet) console.warn('[WAHA] QR request failed:', e?.message || e);
    return {
      success: false,
      qr: null,
      raw: null,
      error: e?.message || String(e),
    };
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

  const pathStr = String(path || '').startsWith('/') ? path : `/${path}`;
  const methodUpper = String(method || 'GET').toUpperCase();
  const base = WAHA_BASE_URL.replace(/\/$/, '');
  const url = `${base}${pathStr}`;

  console.log('[WAHA] Request:', methodUpper, url);

  try {
    const cfg = {
      method: methodUpper,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      timeout: timeoutMs(),
    };
    cfg.url = pathStr;
    if (data != null && methodUpper !== 'GET' && methodUpper !== 'HEAD') {
      cfg.data = data;
    }
    const response = await withWahaTimeout(wahaClient.request(cfg), WAHA_GLOBAL_TIMEOUT_MS);
    return response.data;
  } catch (error) {
    if (error.response) {
      const status = error.response.status;
      let msg;
      if (status === 401) {
        msg = 'WAHA ERROR 401: não autorizado (valide WAHA_API_KEY no backend e no container WAHA)';
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
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      err.code = SessionOpErrorCode.PROVIDER_TIMEOUT;
    }
    throw err;
  }
}

/**
 * Obtém imagem QR da sessão via REST (rota auth/qr + fallbacks legados).
 * @param {string} sessionName
 * @param {{ correlationId?: string|null }} [opts]
 */
export async function fetchWahaSessionQrcodeRest(sessionName, opts = {}) {
  try {
    validateWahaEnv();
  } catch {
    return null;
  }
  const name = String(sessionName ?? 'default').trim() || 'default';
  const enc = encodeURIComponent(name);
  const paths = [`/api/${enc}/auth/qr`];
  const qrRestMs = parseInt(process.env.WHATSAPP_QR_REST_TIMEOUT_MS || '12000', 10) || 12000;
  const correlationId = opts.correlationId ?? null;

  try {
    return await withTimeout(
      (async () => {
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
              return url;
            }
          } catch (e) {
            const st = e.httpStatus ?? e.response?.status;
            if (st === 401) {
              return null;
            }
            if (st === 404) {
              continue;
            }
          }
        }
        return null;
      })(),
      qrRestMs,
      {
        code: SessionOpErrorCode.QR_TIMEOUT,
        message: `Obtenção de QR REST excedeu ${qrRestMs}ms`,
        correlationId,
        operation: 'fetch_waha_qr_rest',
      },
    );
  } catch {
    return null;
  }
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
