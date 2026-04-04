/**
 * Cliente HTTP direto da Evolution API — usado apenas pelo worker BullMQ.
 * Não importar em rotas ou serviços de domínio; use evolutionService.js.
 */

import axios from 'axios';
import { evolutionLog } from '../utils/evolutionLog.js';
import { getProviderAuthHeadersSync } from './providerAuthResolver.js';

const EXP_MAX = 5;
const BASE_DELAY_MS = 1000;

const getBaseUrl = () => {
  const url =
    process.env.EVOLUTION_API_URL ||
    process.env.EVOLUTION_URL ||
    'http://saas_evolution:8080';
  return url.replace(/\/$/, '');
};

/**
 * Header apikey para Evolution. Com EVOLUTION_API_URL definida, exige EVOLUTION_API_KEY (SaaS).
 * Sem URL, aceita AUTHENTICATION_API_KEY para scripts/webhooks legados.
 */
export const getEvolutionApiKey = () => {
  const url = (process.env.EVOLUTION_API_URL || process.env.EVOLUTION_URL || '').trim();
  const key =
    url !== ''
      ? process.env.EVOLUTION_API_KEY
      : process.env.EVOLUTION_API_KEY || process.env.AUTHENTICATION_API_KEY;
  if (!key || String(key).trim() === '') {
    if (url !== '') {
      throw new Error('EVOLUTION_API_KEY é obrigatória quando EVOLUTION_API_URL está definida.');
    }
    throw new Error('Defina EVOLUTION_API_KEY ou AUTHENTICATION_API_KEY para chamadas à Evolution API.');
  }
  return String(key).trim();
};

const getApiKey = () => getEvolutionApiKey();

const getHeaders = () => ({
  ...getProviderAuthHeadersSync('evolution'),
  apikey: getApiKey(),
  'Content-Type': 'application/json',
});

const opts = (timeout = 25000) => ({ timeout, headers: getHeaders() });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function responseText(err) {
  const d = err.response?.data;
  if (d == null) return err.message || '';
  if (typeof d === 'string') return d;
  try {
    return JSON.stringify(d);
  } catch {
    return String(d);
  }
}

export function isEvolutionTransientError(err) {
  const st = err.response?.status;
  const txt = (responseText(err) + (err.message || '')).toLowerCase();
  if (!err.response && (err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || err.code === 'ECONNREFUSED'))
    return true;
  if (st === 502 || st === 503 || st === 504) return true;
  if (st === 500 && /prisma|authentication failed|database|timeout|connect|query/i.test(txt)) return true;
  return false;
}

function isTransientError(err) {
  return isEvolutionTransientError(err);
}

function stripUndefinedDeep(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (Array.isArray(value)) {
    return value.map(stripUndefinedDeep).filter((v) => v !== undefined);
  }
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      const cleaned = stripUndefinedDeep(v);
      if (cleaned !== undefined) out[k] = cleaned;
    }
    return out;
  }
  return value;
}

function getDefaultBaileysSettings() {
  return {
    rejectCall: false,
    msgCall: '',
    groupsIgnore: false,
    alwaysOnline: false,
    readMessages: false,
    readStatus: false,
    syncFullHistory: false,
  };
}

function logEvolutionHttpError(context, err) {
  const res = err.response;
  console.error(
    `[evolution-http] ${context}`,
    JSON.stringify(
      {
        message: err.message,
        code: err.code,
        status: res?.status,
        statusText: res?.statusText,
        data: res?.data,
        url: err.config?.url,
        method: err.config?.method,
      },
      null,
      2
    )
  );
}

/**
 * Até 5 tentativas com backoff exponencial: 1s, 2s, 4s, 8s, 16s.
 */
export async function withExponentialRetry(fn, operation, instanceName) {
  let lastErr;
  for (let i = 0; i < EXP_MAX; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const canRetry = i < EXP_MAX - 1 && isTransientError(err);
      if (canRetry) {
        const delay = BASE_DELAY_MS * 2 ** i;
        evolutionLog(`${operation}_RETRY`, instanceName, { attempt: i + 1, delayMs: delay });
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

/**
 * POST /instance/create — payload Evolution v2 (WHATSAPP-BAILEYS), sem undefined.
 */
export async function createInstance(instanceName) {
  const safeName = String(instanceName ?? '').trim();
  if (!safeName) {
    throw new Error('instanceName é obrigatório para criar instância na Evolution.');
  }

  const baseUrl = getBaseUrl();
  const webhookUrl =
    process.env.EVOLUTION_WEBHOOK_URL || process.env.PUBLIC_EVOLUTION_WEBHOOK_URL || null;

  const raw = {
    instanceName: safeName,
    integration: 'WHATSAPP-BAILEYS',
    qrcode: true,
    ...getDefaultBaileysSettings(),
    ...(webhookUrl
      ? {
          webhook: stripUndefinedDeep({
            url: String(webhookUrl).trim(),
            byEvents: true,
            base64: false,
            events: ['MESSAGES_UPSERT', 'QRCODE_UPDATED', 'CONNECTION_UPDATE'],
          }),
        }
      : {}),
  };

  const payload = stripUndefinedDeep(raw);
  console.log('[WHATSAPP_PROVISION] POST /instance/create', { instanceName: safeName, payloadKeys: Object.keys(payload) });

  evolutionLog('CREATE_HTTP', safeName);
  try {
    const r = await axios.post(`${baseUrl}/instance/create`, payload, opts(60000));
    evolutionLog('CREATE_HTTP_OK', safeName);
    console.log('[WHATSAPP_PROVISION] create response ok', { instanceName: safeName, status: r.status });
    return r.data;
  } catch (err) {
    console.error('ERRO EVOLUTION:', err.response?.data || err.message);
    logEvolutionHttpError('POST /instance/create falhou', err);
    const wrapped = new Error('Falha ao criar instância WhatsApp');
    wrapped.cause = err;
    throw wrapped;
  }
}

export async function disconnectInstance(instanceName) {
  const baseUrl = getBaseUrl();
  const enc = encodeURIComponent(instanceName);
  const path = `/instance/logout/${enc}`;
  const url = `${baseUrl}${path}`;
  evolutionLog('DISCONNECT_HTTP', instanceName);

  return withExponentialRetry(
    async () => {
      try {
        const r = await axios.get(url, opts());
        evolutionLog('DISCONNECT_HTTP_OK', instanceName);
        return r.data;
      } catch (err) {
        if (err.response?.status === 405) {
          const r = await axios.delete(url, opts());
          evolutionLog('DISCONNECT_HTTP_OK', instanceName);
          return r.data;
        }
        throw err;
      }
    },
    'DISCONNECT',
    instanceName
  );
}

async function disconnectBestEffort(instanceName) {
  try {
    await disconnectInstance(instanceName);
  } catch {
    /* intencional */
  }
}

export async function connectInstanceSoft(instanceName) {
  const baseUrl = getBaseUrl();
  const path = `/instance/connect/${encodeURIComponent(instanceName)}`;
  const url = `${baseUrl}${path}`;
  console.log('[WHATSAPP_CONNECT] POST|GET /instance/connect', { instance: instanceName, mode: 'soft' });
  evolutionLog('CONNECT_SOFT_HTTP', instanceName);

  return withExponentialRetry(
    async () => {
      try {
        const r = await axios.post(url, {}, opts());
        evolutionLog('CONNECT_SOFT_HTTP_OK', instanceName);
        return r.data;
      } catch (err) {
        const st = err.response?.status;
        if (st === 405 || st === 404) {
          const r = await axios.get(url, opts());
          evolutionLog('CONNECT_SOFT_HTTP_OK', instanceName);
          return r.data;
        }
        throw err;
      }
    },
    'CONNECT_SOFT',
    instanceName
  );
}

async function performConnect(instanceName) {
  return connectInstanceSoft(instanceName);
}

/** Disconnect + connect — usar só em reset explícito (evita loop no fluxo SaaS). */
export async function connectInstanceWithReset(instanceName) {
  evolutionLog('CONNECT_RESET', instanceName);
  console.log('[WHATSAPP_CONNECT] connect com reset (logout antes)', { instance: instanceName });
  await disconnectBestEffort(instanceName);
  evolutionLog('CONNECT_AFTER_RESET', instanceName);
  return performConnect(instanceName);
}

export async function connectInstance(instanceName) {
  return connectInstanceWithReset(instanceName);
}

async function fetchQrOnce(instanceName) {
  const baseUrl = getBaseUrl();
  const path = `/instance/qrcode/${encodeURIComponent(instanceName)}`;
  evolutionLog('QRCODE_HTTP', instanceName);
  const { data } = await axios.get(`${baseUrl}${path}`, opts());
  evolutionLog('QRCODE_HTTP_OK', instanceName);
  return data;
}

export async function getQRCode(instanceName) {
  return withExponentialRetry(
    async () => {
      try {
        return await fetchQrOnce(instanceName);
      } catch (err) {
        const st = err.response?.status;
        if (st === 404 || st === 500) {
          evolutionLog('QRCODE_RECOVER', instanceName, { httpStatus: st });
          console.log('[WHATSAPP_ARTIFACT] QR 404/500 → um connect soft antes de repetir', { instance: instanceName });
          await connectInstanceSoft(instanceName);
          return await fetchQrOnce(instanceName);
        }
        throw err;
      }
    },
    'QRCODE',
    instanceName
  );
}

export async function getConnectionStatus(instanceName) {
  const baseUrl = getBaseUrl();
  const path = `/instance/connectionState/${encodeURIComponent(instanceName)}`;
  evolutionLog('STATUS_HTTP', instanceName);
  return withExponentialRetry(
    () =>
      axios.get(`${baseUrl}${path}`, opts()).then((r) => {
        evolutionLog('STATUS_HTTP_OK', instanceName);
        return r.data;
      }),
    'STATUS',
    instanceName
  );
}

export async function deleteInstance(instanceName) {
  const baseUrl = getBaseUrl();
  const enc = encodeURIComponent(instanceName);
  const path = `/instance/delete/${enc}`;
  evolutionLog('DELETE_HTTP', instanceName);
  return withExponentialRetry(
    () =>
      axios.delete(`${baseUrl}${path}`, opts()).then((r) => {
        evolutionLog('DELETE_HTTP_OK', instanceName);
        return r.data;
      }),
    'DELETE',
    instanceName
  );
}

export async function fetchInstances() {
  const baseUrl = getBaseUrl();
  evolutionLog('FETCH_INSTANCES_HTTP', null);
  return withExponentialRetry(
    () =>
      axios.get(`${baseUrl}/instance/fetchInstances`, opts()).then((r) => {
        evolutionLog('FETCH_INSTANCES_HTTP_OK', null);
        return r.data;
      }),
    'HEALTH',
    'fetchInstances'
  );
}

export async function sendText(instance, number, text) {
  const EVOLUTION_URL = process.env.EVOLUTION_URL || process.env.EVOLUTION_API_URL;

  if (!EVOLUTION_URL || !(process.env.EVOLUTION_API_KEY || process.env.AUTHENTICATION_API_KEY)) {
    throw new Error('EVOLUTION_URL and EVOLUTION_API_KEY (ou AUTHENTICATION_API_KEY) must be set');
  }

  let instanceEncoded = instance;
  if (/%[0-9A-Fa-f]{2}/.test(instance)) {
    try {
      instanceEncoded = decodeURIComponent(instance);
    } catch {
      /* keep */
    }
  }
  instanceEncoded = encodeURIComponent(instanceEncoded);

  const url = `${EVOLUTION_URL.replace(/\/$/, '')}/message/sendText/${instanceEncoded}`;
  evolutionLog('SEND_TEXT_HTTP', instance, { number });

  await withExponentialRetry(
    () =>
      axios.post(
        url,
        { number, text },
        opts(20000)
      ),
    'SEND_TEXT',
    instance
  );
  evolutionLog('SEND_TEXT_HTTP_OK', instance, { number });
}
