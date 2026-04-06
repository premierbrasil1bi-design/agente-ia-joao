/**
 * Fluxo dedicado WAHA: start → aguardar SCAN_QR_CODE → obter QR (sem POST /api/sessions).
 * URL via wahaHttp (WAHA_API_URL; com API key fixa no WAHA).
 */

import { wahaRequest, validateWahaEnv } from './wahaHttp.js';
import { getCurrentQr } from './wahaQrCapture.js';

const POLL_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 1000;
/** Aguarda QR aparecer no stdout do container (captura em memória). */
const QR_FETCH_ATTEMPTS = 30;
const QR_FETCH_DELAY_MS = 1000;

function sleepMs(ms) {
  return new Promise((r) => setTimeout(r, ms));
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

function extractStatusFromEntry(entry) {
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

function findSessionInList(list, sessionName) {
  return list.find((s) => sessionNameMatches(s, sessionName)) ?? null;
}

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
 * Status atual da sessão no WAHA (GET por nome).
 * @param {string} sessionName
 */
export async function getWahaSessionStatus(sessionName) {
  try {
    validateWahaEnv();
  } catch (e) {
    return { ok: false, error: e?.message || 'WAHA não configurado', name: sessionName };
  }
  const name = String(sessionName ?? '').trim();
  if (!name) return { ok: false, error: 'Nome de sessão inválido' };
  try {
    const data = await wahaRequest('GET', `/api/sessions/${encodeURIComponent(name)}`);
    const status = extractStatusFromEntry(data);
    return { ok: true, data, status, normalized: normalizeWahaStatus(status), name };
  } catch (err) {
    const st = err.httpStatus ?? err.response?.status;
    if (st === 404) return { ok: false, notFound: true, name };
    return { ok: false, error: err.message, httpStatus: st, name };
  }
}

/**
 * Garante sessão iniciada, aguarda SCAN_QR_CODE e obtém QR (fluxo idempotente via /sessions/start).
 * @param {string} [sessionName='default']
 * @returns {Promise<{ success: true, qr: string } | { success: false, error: string, code?: string }>}
 */
export async function ensureWahaQrSession(sessionName = 'default') {
  try {
    validateWahaEnv();
  } catch (e) {
    return { success: false, error: e?.message || 'WAHA não configurado' };
  }

  const name = String(sessionName ?? 'default').trim();
  if (!name) return { success: false, error: 'Nome de sessão inválido' };

  const st0 = await getWahaSessionStatus(name);
  if (st0.ok && normalizeWahaStatus(st0.status) === 'CONNECTED') {
    return { success: false, error: 'already_connected', code: 'CONNECTED' };
  }

  console.log('[WAHA] Starting session');
  try {
    await wahaRequest('POST', '/api/sessions/start', { name });
  } catch (err) {
    const st = err.httpStatus ?? err.response?.status;
    if (st === 401) {
      return { success: false, error: err.message || 'WAHA não autorizado' };
    }
    try {
      await wahaRequest('POST', '/api/sessions/start', { session: name });
    } catch (err2) {
      const st2 = err2.httpStatus ?? err2.response?.status;
      if (st2 === 401) {
        return { success: false, error: err2.message || 'WAHA não autorizado' };
      }
    }
  }

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let lastStatus = null;

  while (Date.now() < deadline) {
    console.log('[WAHA] Waiting for QR');
    try {
      const raw = await wahaRequest('GET', '/api/sessions');
      const list = extractSessionsArray(raw);
      const entry = findSessionInList(list, name);
      const status = entry ? extractStatusFromEntry(entry) : null;
      lastStatus = status;
      const norm = normalizeWahaStatus(status);

      if (norm === 'CONNECTED') {
        return { success: false, error: 'already_connected', code: 'CONNECTED' };
      }
      if (norm === 'SCAN_QR_CODE') {
        break;
      }
    } catch (err) {
      const st = err.httpStatus ?? err.response?.status;
      if (st === 401) {
        return { success: false, error: err.message || 'WAHA não autorizado' };
      }
    }
    await sleepMs(POLL_INTERVAL_MS);
  }

  let ready = normalizeWahaStatus(lastStatus) === 'SCAN_QR_CODE';
  if (!ready) {
    try {
      const one = await wahaRequest('GET', `/api/sessions/${encodeURIComponent(name)}`);
      const norm = normalizeWahaStatus(extractStatusFromEntry(one));
      if (norm === 'CONNECTED') {
        return { success: false, error: 'already_connected', code: 'CONNECTED' };
      }
      ready = norm === 'SCAN_QR_CODE';
    } catch {
      /* ignore */
    }
  }

  if (!ready) {
    return { success: false, error: 'WAHA session initialization timeout' };
  }

  for (let i = 0; i < QR_FETCH_ATTEMPTS; i++) {
    const qr = getCurrentQr();
    if (qr && isValidQrPayload(qr)) {
      console.log('[WAHA] QR pronto (captura de logs)');
      return { success: true, qr };
    }
    if (i < QR_FETCH_ATTEMPTS - 1) {
      await sleepMs(QR_FETCH_DELAY_MS);
    }
  }

  return { success: false, error: 'QR não disponível após tentativas' };
}
