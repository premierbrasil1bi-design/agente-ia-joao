/**
 * Cliente HTTP WAHA (WhatsApp HTTP API) — REST documentado em https://waha.devlike.pro
 * Usado quando channels.provider === 'waha'.
 */

import axios from 'axios';

function getBaseUrl() {
  const raw = process.env.WAHA_URL || 'http://127.0.0.1:3099';
  return String(raw).replace(/\/$/, '');
}

function getHeaders() {
  const h = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  const key = (process.env.WAHA_API_KEY || '').trim();
  if (key) h['X-Api-Key'] = key;
  return h;
}

const opts = (timeout = 60000) => ({ timeout, headers: getHeaders() });

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
    const baseUrl = getBaseUrl();
    const { data } = await axios.post(
      `${baseUrl}/api/sessions`,
      { name: safe, start: true },
      opts()
    );
    return { ok: true, data };
  } catch (err) {
    const st = err.response?.status;
    if (st === 409 || st === 400) {
      try {
        await axios.post(`${getBaseUrl()}/api/sessions/${encodeURIComponent(safe)}/start`, {}, opts());
        return { ok: true, data: { name: safe, reused: true } };
      } catch (e2) {
        console.error('[WAHA] createSession retry start:', e2.message);
        return { ok: false, error: e2.message || 'Falha ao iniciar sessão WAHA existente.' };
      }
    }
    console.error('[WAHA] createSession:', err.message);
    return { ok: false, error: err.message || 'Falha ao criar sessão WAHA.' };
  }
}

/**
 * QR em base64 (ou data URL) — POST /api/{session}/auth/qr
 */
export async function getQrCode(name) {
  const safe = String(name || '').trim();
  if (!safe) {
    return { ok: false, error: 'Nome da sessão WAHA é obrigatório.', raw: null };
  }
  console.log('[WAHA] Fetching QR', safe);
  try {
    const baseUrl = getBaseUrl();
    const { data } = await axios.post(
      `${baseUrl}/api/${encodeURIComponent(safe)}/auth/qr`,
      {},
      opts()
    );
    return { ok: true, data, raw: data };
  } catch (err) {
    console.error('[WAHA] getQrCode:', err.message);
    return { ok: false, error: err.message || 'Falha ao obter QR WAHA.', raw: null };
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
    const baseUrl = getBaseUrl();
    const { data } = await axios.get(`${baseUrl}/api/sessions/${encodeURIComponent(safe)}`, opts(30000));
    return { ok: true, data };
  } catch (err) {
    console.error('[WAHA] getSessionStatus:', err.message);
    return { ok: false, error: err.message || 'Falha ao consultar sessão WAHA.', data: null };
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
    const baseUrl = getBaseUrl();
    const { data } = await axios.post(`${baseUrl}/api/sendText`, body, opts(20000));
    return { ok: true, data };
  } catch (err) {
    console.error('[WAHA] sendMessage:', err.message);
    return { ok: false, error: err.message || 'Falha ao enviar mensagem WAHA.' };
  }
}

export async function logoutSession(name) {
  const safe = String(name || '').trim();
  if (!safe) return { ok: true, skipped: true };
  try {
    const baseUrl = getBaseUrl();
    await axios.post(`${baseUrl}/api/sessions/${encodeURIComponent(safe)}/logout`, {}, opts());
    return { ok: true };
  } catch (err) {
    console.warn('[WAHA] logoutSession:', err.message);
    return { ok: false, error: err.message };
  }
}

export async function deleteSession(name) {
  const safe = String(name || '').trim();
  if (!safe) return { ok: true, skipped: true };
  try {
    const baseUrl = getBaseUrl();
    await axios.delete(`${baseUrl}/api/sessions/${encodeURIComponent(safe)}`, opts());
    return { ok: true };
  } catch (err) {
    if (err.response?.status === 404) return { ok: true, missing: true };
    console.warn('[WAHA] deleteSession:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Configura webhooks para a sessão no WAHA.
 * - message => para recebimento
 * - session.status => para status automático (connected/disconnected/error)
 */
export async function setWebhook(name) {
  const safe = String(name || '').trim();
  if (!safe) {
    return { ok: false, error: 'Nome da sessão WAHA é obrigatório.' };
  }

  const apiUrl =
    (process.env.API_URL || '').trim() || 'https://api.omnia1biai.com.br';

  const webhookUrl = `${apiUrl.replace(/\/$/, '')}/api/channels/webhook/waha`;
  console.log('[WAHA] Configuring webhook', { session: safe, webhookUrl });

  const baseUrl = getBaseUrl();
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
    // Preferência: PUT /api/sessions/{session}/ (Update Session)
    const { data } = await axios.put(`${baseUrl}/api/sessions/${encodeURIComponent(safe)}`, body, opts());
    return { ok: true, data };
  } catch (err) {
    // Fallback: algumas versões/rotas aceitam trailing slash
    try {
      const { data } = await axios.put(
        `${baseUrl}/api/sessions/${encodeURIComponent(safe)}/`,
        body,
        opts()
      );
      return { ok: true, data };
    } catch (err2) {
      console.error('[WAHA] setWebhook falhou:', err2?.message || err.message);
      return { ok: false, error: err2?.message || err.message };
    }
  }
}

export function isWahaUnreachableError(err) {
  const c = err?.code;
  return c === 'ECONNREFUSED' || c === 'ENOTFOUND' || c === 'ETIMEDOUT';
}
