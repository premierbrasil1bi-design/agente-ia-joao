/**
 * Cliente HTTP WAHA (WhatsApp HTTP API) — https://waha.devlike.pro
 * Autenticação: header X-Api-Key (WAHA_API_KEY) em todas as requisições.
 */

import axios from 'axios';

// WAHA Core (free) permite apenas uma sessão fixa.
const WAHA_SINGLE_SESSION = 'default';

function getBaseURL() {
  const raw = process.env.WAHA_URL || 'http://127.0.0.1:3099';
  return String(raw).replace(/\/$/, '');
}

function getApiKey() {
  return String(process.env.WAHA_API_KEY || '').trim();
}

const api = axios.create({
  baseURL: getBaseURL(),
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'X-Api-Key': getApiKey(),
  },
  timeout: 60000,
});

api.interceptors.request.use((config) => {
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
 * @param {string} name - nome da sessão WAHA (id estável por canal)
 */
export async function createSession(name) {
  // Ignora qualquer nome dinâmico: sessão única "default"
  const sessionName = WAHA_SINGLE_SESSION;
  console.log('[WAHA] Creating session', sessionName);
  try {
    const { data } = await api.post('/api/sessions', { name: sessionName, start: true });
    return { ok: true, data };
  } catch (err) {
    const st = err.response?.status;
    // Se já existir, não deve tentar recriar (idempotente).
    if (st === 409 || st === 400) {
      try {
        await api.post(`/api/sessions/${encodeURIComponent(sessionName)}/start`, {});
        return { ok: true, data: { name: sessionName, reused: true } };
      } catch (e2) {
        console.error('[WAHA] createSession retry start:', e2.message);
        return wahaErr(e2);
      }
    }
    return wahaErr(err);
  }
}

/**
 * QR em base64 — POST /api/{session}/auth/qr
 */
export async function getQrCode(name) {
  const sessionName = WAHA_SINGLE_SESSION;
  console.log('[WAHA] Fetching QR Code via /api/default/auth/qr');
  try {
    const { data } = await api.get('/api/default/auth/qr');
    return { ok: true, data: data?.qr || data?.base64 || data, raw: data };
  } catch (err) {
    return { ...wahaErr(err), raw: null };
  }
}

/**
 * GET /api/sessions/{name}
 */
export async function getSessionStatus(name) {
  const sessionName = WAHA_SINGLE_SESSION;
  try {
    const { data } = await api.get(`/api/sessions/${encodeURIComponent(sessionName)}`, { timeout: 30000 });
    return { ok: true, data };
  } catch (err) {
    return { ...wahaErr(err), data: null };
  }
}

/**
 * chatId = número apenas dígitos + @c.us
 */
export async function sendMessage(name, number, text) {
  const sessionName = WAHA_SINGLE_SESSION;
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
  const sessionName = WAHA_SINGLE_SESSION;
  try {
    await api.post(`/api/sessions/${encodeURIComponent(sessionName)}/logout`, {});
    return { ok: true };
  } catch (err) {
    console.warn('[WAHA] logoutSession:', err.message);
    return wahaErr(err);
  }
}

export async function deleteSession(name) {
  const sessionName = WAHA_SINGLE_SESSION;
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
  const sessionName = WAHA_SINGLE_SESSION;

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
      return wahaErr(err2);
    }
  }
}

export function isWahaUnreachableError(err) {
  const c = err?.code;
  return c === 'ECONNREFUSED' || c === 'ENOTFOUND' || c === 'ETIMEDOUT';
}
