/**
 * Cliente HTTP WAHA (WhatsApp HTTP API) — https://waha.devlike.pro
 * Autenticação opcional: header X-Api-Key (WAHA_API_KEY) quando definido.
 */

import axios from 'axios';

function getBaseURL() {
  const raw =
    process.env.WAHA_API_URL || process.env.WAHA_URL || 'http://127.0.0.1:3000';
  return String(raw).replace(/\/$/, '');
}

function getApiKey() {
  return String(process.env.WAHA_API_KEY || '').trim();
}

function buildHeaders() {
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  const key = getApiKey();
  if (key) headers['X-Api-Key'] = key;
  return headers;
}

const api = axios.create({
  baseURL: getBaseURL(),
  headers: buildHeaders(),
  timeout: 60000,
});

api.interceptors.request.use((config) => {
  config.baseURL = getBaseURL();
  config.headers = { ...buildHeaders(), ...config.headers };
  const method = (config.method || 'get').toUpperCase();
  const path = config.url || '';
  console.log(`[WAHA] Request → ${method} ${path}`);
  return config;
});

api.interceptors.response.use(
  (response) => {
    const path = response.config?.url || '';
    console.log(`[WAHA] Response OK ${path}`);
    return response;
  },
  (err) => {
    const st = err.response?.status;
    if (st === 401) {
      console.error('[WAHA ERROR] Unauthorized - API KEY inválida ou ausente');
    } else {
      console.error('[WAHA ERROR]', err.response?.status || err.code || '', err.message);
    }
    return Promise.reject(err);
  }
);

function wahaErr(err) {
  const st = err.response?.status;
  const msg =
    st === 401
      ? 'WAHA: não autorizado (verifique WAHA_API_KEY).'
      : err.message || 'Erro na API WAHA.';
  return { ok: false, error: msg, code: st === 401 ? 'UNAUTHORIZED' : undefined };
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
 * Teste de conectividade e autenticação (GET /api/sessions).
 */
export async function testWahaConnection() {
  try {
    const res = await api.get('/api/sessions');
    console.log('[WAHA] Conexão OK');
    return res.data;
  } catch (err) {
    console.error('[WAHA] Falha na conexão', err.message);
    throw err;
  }
}

/**
 * Cria ou inicia sessão no WAHA.
 * Tenta: POST /api/sessions { name, start }; depois POST .../sessions/:name/start; depois POST /api/sessions/start.
 */
export async function createSession(name) {
  const sessionName = normalizeSessionName(name);
  console.log('[WAHA] Creating session', sessionName);
  console.log('WAHA URL:', getBaseURL());
  try {
    const { data } = await api.post('/api/sessions', {
      name: sessionName,
      start: true,
    });
    return { ok: true, data };
  } catch (err) {
    console.error('ERRO WAHA:', err.response?.data || err.message);
    const st = err.response?.status;
    if (st === 409 || st === 400) {
      try {
        await api.post(`/api/sessions/${encodeURIComponent(sessionName)}/start`, {});
        return { ok: true, data: { name: sessionName, reused: true } };
      } catch (e2) {
        console.error('ERRO WAHA:', e2.response?.data || e2.message);
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
 * QR — tenta rotas comuns conforme versão do WAHA (GOWS / NOWEB).
 */
export async function getQrCode(name) {
  const sessionName = normalizeSessionName(name);
  console.log('[WAHA] Fetching QR for session', sessionName);
  const paths = [
    `/api/${encodeURIComponent(sessionName)}/auth/qr`,
    `/api/sessions/${encodeURIComponent(sessionName)}/qrcode`,
    `/api/sessions/${encodeURIComponent(sessionName)}/qr`,
  ];
  let lastErr;
  for (const path of paths) {
    try {
      const { data } = await api.get(path);
      const raw = data?.qr ?? data?.base64 ?? data?.qrcode ?? data;
      return { ok: true, data: raw, raw: data };
    } catch (err) {
      lastErr = err;
      console.error('ERRO WAHA:', err.response?.data || err.message);
      const st = err.response?.status;
      if (st && st !== 404) {
        return { ...wahaErr(err), raw: null };
      }
    }
  }
  return { ...wahaErr(lastErr || new Error('QR não disponível')), raw: null };
}

/**
 * GET /api/sessions/{name}
 */
export async function getSessionStatus(name) {
  const sessionName = normalizeSessionName(name);
  try {
    const { data } = await api.get(`/api/sessions/${encodeURIComponent(sessionName)}`, {
      timeout: 30000,
    });
    return { ok: true, data };
  } catch (err) {
    return { ...wahaErr(err), data: null };
  }
}

/**
 * chatId = número apenas dígitos + @c.us
 */
export async function sendMessage(name, number, text) {
  const sessionName = normalizeSessionName(name);
  const digits = String(number || '').replace(/\D/g, '');
  const body = {
    session: sessionName,
    chatId: `${digits}@c.us`,
    text: String(text ?? ''),
  };
  console.log('[WAHA] Sending message', { session: sessionName, chatId: body.chatId });
  try {
    const { data } = await api.post('/api/sendText', body, { timeout: 20000 });
    return { ok: true, data };
  } catch (err) {
    return wahaErr(err);
  }
}

export async function logoutSession(name) {
  const sessionName = normalizeSessionName(name);
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
  try {
    await api.delete(`/api/sessions/${encodeURIComponent(sessionName)}`);
    return { ok: true };
  } catch (err) {
    if (err.response?.status === 404) return { ok: true, missing: true };
    console.warn('[WAHA] deleteSession:', err.message);
    return wahaErr(err);
  }
}

/**
 * Configura webhooks na sessão (message + session.status).
 */
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

  try {
    const { data } = await api.put(`/api/sessions/${encodeURIComponent(sessionName)}`, body);
    return { ok: true, data };
  } catch (err) {
    try {
      const { data } = await api.put(`/api/sessions/${encodeURIComponent(sessionName)}/`, body);
      return { ok: true, data };
    } catch (err2) {
      console.error('ERRO WAHA:', err2.response?.data || err2.message);
      return wahaErr(err2);
    }
  }
}

export function isWahaUnreachableError(err) {
  const c = err?.code;
  return c === 'ECONNREFUSED' || c === 'ENOTFOUND' || c === 'ETIMEDOUT';
}
