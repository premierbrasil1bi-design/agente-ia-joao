/**
 * Cliente HTTP único para WAHA — WAHA_API_URL e WAHA_API_KEY via process.env.
 * Autenticação: header x-api-key (esperado pelo WAHA em Docker, ex.: http://saas_waha:3000).
 */

import axios from 'axios';

const WAHA_API_URL = (process.env.WAHA_API_URL || process.env.WAHA_URL || '').trim();
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
    const cfg = {
      method: methodUpper,
      url,
      headers: {
        'x-api-key': WAHA_API_KEY,
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

export const wahaProvider = {
  getSessions: () => wahaRequest('GET', '/api/sessions'),

  createSession: (sessionName) =>
    wahaRequest('POST', '/api/sessions', {
      name: sessionName,
      start: true,
    }),

  getQrCode: (sessionName) =>
    wahaRequest('GET', `/api/sessions/${encodeURIComponent(sessionName)}/qr`),
};
