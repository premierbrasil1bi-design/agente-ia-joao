/**
 * Cliente HTTP WAHA (WhatsApp HTTP API) — https://waha.devlike.pro
 * Autenticação: header X-Api-Key (WAHA_API_KEY) em todas as requisições.
 */

import axios from 'axios';

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
  const safe = String(name || '').trim();
  if (!safe) {
    return { ok: false, error: 'Nome da sessão WAHA é obrigatório.' };
  }
  console.log('[WAHA] Creating session', safe);
  try {
    const { data } = await api.post('/api/sessions', { name: safe, start: true });
    return { ok: true, data };
  } catch (err) {
    const st = err.response?.status;
    if (st === 409 || st === 400) {
      try {
        await api.post(`/api/sessions/${encodeURIComponent(safe)}/start`, {});
        return { ok: true, data: { name: safe, reused: true } };
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
  const safe = String(name || '').trim();
  if (!safe) {
    return { ok: false, error: 'Nome da sessão WAHA é obrigatório.', raw: null };
  }
  console.log('[WAHA] Fetching QR', safe);
  try {
    const { data } = await api.post(`/api/${encodeURIComponent(safe)}/auth/qr`, {});
    return { ok: true, data, raw: data };
  } catch (err) {
    return { ...wahaErr(err), raw: null };
  }
}

/**
 * GET /api/sessions/{name}
 */
export async function getSessionStatus(name) {
  const safe = String(name || '').trim();
  if (!safe) {
    return { ok: false, error: 'Nome da sessão WAHA é obrigatório.', data: null };
  }
  try {
    const { data } = await api.get(`/api/sessions/${encodeURIComponent(safe)}`, { timeout: 30000 });
    return { ok: true, data };
  } catch (err) {
    return { ...wahaErr(err), data: null };
  }
}

/**
 * chatId = número apenas dígitos + @c.us
 */
export async function sendMessage(name, number, text) {
  const safe = String(name || '').trim();
  const digits = String(number || '').replace(/\D/g, '');
  const body = {
    session: safe,
    chatId: `${digits}@c.us`,
    text: String(text ?? ''),
  };
  console.log('[WAHA] Sending message', { session: safe, chatId: body.chatId });
  try {
    const { data } = await api.post('/api/sendText', body, { timeout: 20000 });
    return { ok: true, data };
  } catch (err) {
    return wahaErr(err);
  }
}

export async function logoutSession(name) {
  const safe = String(name || '').trim();
  if (!safe) return { ok: true, skipped: true };
  try {
    await api.post(`/api/sessions/${encodeURIComponent(safe)}/logout`, {});
    return { ok: true };
  } catch (err) {
    console.warn('[WAHA] logoutSession:', err.message);
    return wahaErr(err);
  }
}

export async function deleteSession(name) {
  const safe = String(name || '').trim();
  if (!safe) return { ok: true, skipped: true };
  try {
    await api.delete(`/api/sessions/${encodeURIComponent(safe)}`);
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
  const safe = String(name || '').trim();
  if (!safe) {
    return { ok: false, error: 'Nome da sessão WAHA é obrigatório.' };
  }

  const apiUrl = (process.env.API_URL || '').trim() || 'https://api.omnia1biai.com.br';
  const webhookUrl = `${apiUrl.replace(/\/$/, '')}/api/channels/webhook/waha`;
  console.log('[WAHA] Configuring webhook', { session: safe, webhookUrl });

  const body = {
    name: safe,
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
    const { data } = await api.put(`/api/sessions/${encodeURIComponent(safe)}`, body);
    return { ok: true, data };
  } catch (err) {
    try {
      const { data } = await api.put(`/api/sessions/${encodeURIComponent(safe)}/`, body);
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
