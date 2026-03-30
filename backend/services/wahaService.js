/**
 * Cliente HTTP WAHA (WhatsApp HTTP API) — https://waha.devlike.pro
 * Requer WAHA_API_KEY. URL base: WAHA_API_URL (obrigatório em produção).
 */

import axios from 'axios';

const DEV_FALLBACK_WAHA_URL = 'http://saas_waha:3000';

function isProduction() {
  return String(process.env.NODE_ENV || '').toLowerCase() === 'production';
}

/**
 * URL base do WAHA (sem barra final). Sem localhost fixo: fallback só em dev (rede Docker).
 */
export function getResolvedWahaUrl() {
  const primary = (process.env.WAHA_API_URL || '').trim();
  if (primary) return primary.replace(/\/$/, '');
  const legacy = (process.env.WAHA_URL || '').trim();
  if (legacy) return legacy.replace(/\/$/, '');
  if (!isProduction()) {
    return DEV_FALLBACK_WAHA_URL;
  }
  throw new Error('WAHA_API_URL não configurado');
}

function assertWahaApiKey() {
  const key = String(process.env.WAHA_API_KEY || '').trim();
  if (!key) {
    throw new Error('WAHA_API_KEY não configurado');
  }
  return key;
}

/** @type {import('axios').AxiosInstance | null} */
let _api = null;

function getApi() {
  assertWahaApiKey();
  const baseURL = getResolvedWahaUrl();
  if (!_api) {
    _api = axios.create({
      baseURL,
      headers: buildHeaders(),
      timeout: 60000,
    });
    _api.interceptors.request.use((config) => {
      config.baseURL = getResolvedWahaUrl();
      config.headers = { ...buildHeaders(), ...config.headers };
      const method = (config.method || 'get').toUpperCase();
      const path = config.url || '';
      console.log(`[WAHA] Request → ${method} ${path}`);
      return config;
    });
    _api.interceptors.response.use(
      (response) => {
        const path = response.config?.url || '';
        console.log(`[WAHA] Response OK ${path}`);
        return response;
      },
      (err) => {
        const st = err.response?.status;
        if (st === 401) {
          console.error('[WAHA ERROR]:', err.response?.data || err.message);
        } else {
          console.error('[WAHA ERROR]:', err.response?.data || err.message);
        }
        return Promise.reject(err);
      }
    );
  }
  return _api;
}

function buildHeaders() {
  const key = assertWahaApiKey();
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'X-Api-Key': key,
  };
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
  return s || 'default';
}

/**
 * Nome da sessão WAHA a partir do canal (external_id / instance / provider_config).
 */
export function resolveWahaSessionName(channel) {
  if (!channel || typeof channel !== 'object') return 'default';
  const pc =
    channel.provider_config && typeof channel.provider_config === 'object'
      ? channel.provider_config
      : {};
  const fromPc =
    (pc.session && String(pc.session).trim()) ||
    (pc.instance && String(pc.instance).trim()) ||
    (pc.instanceName && String(pc.instanceName).trim()) ||
    null;
  const ext =
    channel.external_id != null && String(channel.external_id).trim() !== ''
      ? String(channel.external_id).trim()
      : null;
  const inst =
    channel.instance != null && String(channel.instance).trim() !== ''
      ? String(channel.instance).trim()
      : null;
  return fromPc || ext || inst || 'default';
}

/**
 * Valida URL + API key e conectividade básica (GET /api/sessions).
 */
export async function checkWahaHealth() {
  const WAHA_URL = getResolvedWahaUrl();
  console.log('[WAHA] URL:', WAHA_URL);
  console.log('[WAHA] PROVIDER:', 'waha');
  const api = getApi();
  try {
    await api.get('/api/sessions');
    return true;
  } catch (err) {
    console.error('[WAHA ERROR]:', err.response?.data || err.message);
    if (err.response?.status === 401) {
      const e = new Error('WAHA: não autorizado (verifique WAHA_API_KEY).');
      e.httpStatus = 401;
      throw e;
    }
    const e = new Error('WAHA não acessível');
    e.code = 'WAHA_UNREACHABLE';
    e.cause = err;
    throw e;
  }
}

/** @deprecated use checkWahaHealth */
export async function testWahaConnection() {
  return checkWahaHealth();
}

/**
 * Cria ou inicia sessão no WAHA.
 */
export async function createSession(name) {
  const sessionName = normalizeSessionName(name);
  const WAHA_URL = getResolvedWahaUrl();
  console.log('[WAHA] URL:', WAHA_URL);
  console.log('[WAHA] SESSION:', sessionName);
  console.log('[WAHA] PROVIDER:', 'waha');
  const api = getApi();
  try {
    const { data } = await api.post('/api/sessions', {
      name: sessionName,
      start: true,
    });
    return { ok: true, data };
  } catch (err) {
    console.error('[WAHA ERROR]:', err.response?.data || err.message);
    const st = err.response?.status;
    if (st === 401) {
      return { ...wahaErr(err), httpStatus: 401 };
    }
    if (st === 409 || st === 400) {
      try {
        await api.post(`/api/sessions/${encodeURIComponent(sessionName)}/start`, {});
        return { ok: true, data: { name: sessionName, reused: true } };
      } catch (e2) {
        console.error('[WAHA ERROR]:', e2.response?.data || e2.message);
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
 * QR — ordem: auth/qr → sessions/qr → sessions/qrcode
 */
export async function getQrCode(name) {
  const sessionName = normalizeSessionName(name);
  const WAHA_URL = getResolvedWahaUrl();
  console.log('[WAHA] URL:', WAHA_URL);
  console.log('[WAHA] SESSION:', sessionName);
  console.log('[WAHA] PROVIDER:', 'waha');
  const api = getApi();
  const paths = [
    `/api/${encodeURIComponent(sessionName)}/auth/qr`,
    `/api/sessions/${encodeURIComponent(sessionName)}/qr`,
    `/api/sessions/${encodeURIComponent(sessionName)}/qrcode`,
  ];
  let lastErr;
  for (const path of paths) {
    try {
      const { data } = await api.get(path);
      const raw = data?.qr ?? data?.base64 ?? data?.qrcode ?? data;
      return { ok: true, data: raw, raw: data };
    } catch (err) {
      lastErr = err;
      console.error('[WAHA ERROR]:', err.response?.data || err.message);
      const st = err.response?.status;
      if (st && st !== 404) {
        return { ...wahaErr(err), raw: null };
      }
    }
  }
  const msg = 'QR não disponível';
  console.error('[WAHA ERROR]:', msg, lastErr?.response?.data || lastErr?.message);
  return {
    ok: false,
    error: msg,
    raw: null,
    httpStatus: lastErr?.response?.status,
  };
}

export async function getSessionStatus(name) {
  const sessionName = normalizeSessionName(name);
  const api = getApi();
  try {
    const { data } = await api.get(`/api/sessions/${encodeURIComponent(sessionName)}`, {
      timeout: 30000,
    });
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
    const { data } = await api.post('/api/sendText', body, { timeout: 20000 });
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

  const apiUrl = (process.env.API_URL || '').trim() || 'https://api.omnia1biai.com.br';
  const webhookUrl = `${apiUrl.replace(/\/$/, '')}/api/channels/webhook/waha`;
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
      console.error('[WAHA ERROR]:', err2.response?.data || err2.message);
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
