/**
 * Evolution API 2.x – WhatsApp (WHATSAPP-BAILEYS).
 * Header apikey: EVOLUTION_API_KEY (ex.: EVOLUTION_2026_JOAO_998877 via .env).
 */

import axios from 'axios';
import { logger } from '../utils/logger.js';

const RETRY_MAX = 3;
const RETRY_DELAY_MS = 500;

const getBaseUrl = () => {
  const url = process.env.EVOLUTION_API_URL || process.env.EVOLUTION_URL;
  if (!url) throw new Error('EVOLUTION_API_URL ou EVOLUTION_URL deve estar definida.');
  return url.replace(/\/$/, '');
};

const getHeaders = () => ({
  apikey: process.env.EVOLUTION_API_KEY || '',
  'Content-Type': 'application/json',
});

const opts = () => ({ timeout: 20000, headers: getHeaders() });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(fn, operation, instanceName) {
  let lastErr;
  for (let attempt = 1; attempt <= RETRY_MAX; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      logger.apiError(operation, instanceName, err.message || err.response?.data?.message || String(err));
      if (attempt < RETRY_MAX) await sleep(RETRY_DELAY_MS);
    }
  }
  throw lastErr;
}

/**
 * POST /instance/create
 */
export async function createInstance(instanceName) {
  const baseUrl = getBaseUrl();
  const webhookUrl =
    process.env.EVOLUTION_WEBHOOK_URL ||
    process.env.PUBLIC_EVOLUTION_WEBHOOK_URL ||
    null;

  const payload = {
    instanceName,
    integration: 'WHATSAPP-BAILEYS',
  };

  if (webhookUrl) {
    payload.webhook = {
      url: webhookUrl,
      events: ['messages.upsert'],
    };
  }

  console.log('[evolution] createInstance', instanceName);
  return withRetry(
    () =>
      axios.post(`${baseUrl}/instance/create`, payload, opts()).then((r) => {
        console.log('[evolution] createInstance OK', instanceName);
        return r.data;
      }),
    'createInstance',
    instanceName
  );
}

/**
 * GET /instance/logout/:instance — se 405, tenta DELETE (versões antigas).
 */
export async function disconnectInstance(instanceName) {
  const baseUrl = getBaseUrl();
  const enc = encodeURIComponent(instanceName);
  const path = `/instance/logout/${enc}`;
  const url = `${baseUrl}${path}`;
  console.log('[evolution] disconnectInstance', instanceName);

  return withRetry(
    async () => {
      try {
        const r = await axios.get(url, opts());
        console.log('[evolution] disconnectInstance OK (GET)', instanceName);
        return r.data;
      } catch (err) {
        if (err.response?.status === 405) {
          const r = await axios.delete(url, opts());
          console.log('[evolution] disconnectInstance OK (DELETE fallback)', instanceName);
          return r.data;
        }
        throw err;
      }
    },
    'disconnectInstance',
    instanceName
  );
}

/** Sempre ignorar falha — limpa sessão “travada” antes do connect. */
async function disconnectInstanceBestEffort(instanceName) {
  try {
    await disconnectInstance(instanceName);
  } catch {
    /* ignorado propositalmente */
  }
}

/**
 * Apenas pairing (POST connect ou GET fallback).
 */
async function performConnect(instanceName) {
  const baseUrl = getBaseUrl();
  const path = `/instance/connect/${encodeURIComponent(instanceName)}`;
  const url = `${baseUrl}${path}`;
  console.log('[evolution] connectInstance (pairing request)', instanceName);

  return withRetry(
    async () => {
      try {
        const r = await axios.post(url, {}, opts());
        console.log('[evolution] connectInstance OK (POST)', instanceName);
        return r.data;
      } catch (err) {
        const st = err.response?.status;
        if (st === 405 || st === 404) {
          const r = await axios.get(url, opts());
          console.log('[evolution] connectInstance OK (GET fallback)', instanceName);
          return r.data;
        }
        throw err;
      }
    },
    'connectInstance',
    instanceName
  );
}

/**
 * Fluxo obrigatório: disconnect (ignora erro) → connect — evita instância presa em "close".
 */
export async function connectInstance(instanceName) {
  console.log('[evolution] FORCE RESET INSTANCE', instanceName);
  await disconnectInstanceBestEffort(instanceName);
  console.log('[evolution] CONNECT AFTER RESET', instanceName);
  return performConnect(instanceName);
}

async function fetchQrOnce(instanceName) {
  const baseUrl = getBaseUrl();
  const path = `/instance/qrcode/${encodeURIComponent(instanceName)}`;
  console.log('[evolution] getQRCode', instanceName);
  const { data } = await axios.get(`${baseUrl}${path}`, opts());
  console.log('[evolution] getQRCode OK', instanceName);
  return data;
}

/**
 * GET /instance/qrcode/:instance
 * Em 404/500: logout + connect + nova tentativa (instância em pairing / connecting).
 */
export async function getQRCode(instanceName) {
  try {
    return await fetchQrOnce(instanceName);
  } catch (err) {
    const st = err.response?.status;
    if (st === 404 || st === 500) {
      console.log('[evolution] getQRCode failed HTTP', st, '→ disconnect + connect + retry', instanceName);
      await connectInstance(instanceName);
      return await fetchQrOnce(instanceName);
    }
    throw err;
  }
}

export async function getQrCode(instanceName) {
  return getQRCode(instanceName);
}

/**
 * GET /instance/connectionState/:instance
 */
export async function getConnectionStatus(instanceName) {
  const baseUrl = getBaseUrl();
  const path = `/instance/connectionState/${encodeURIComponent(instanceName)}`;
  console.log('[evolution] getStatus', instanceName);
  return withRetry(
    () =>
      axios.get(`${baseUrl}${path}`, opts()).then((r) => {
        console.log('[evolution] getStatus OK', instanceName);
        return r.data;
      }),
    'getStatus',
    instanceName
  );
}

export const getStatus = getConnectionStatus;

export async function getInstanceStatus(instanceName) {
  return getConnectionStatus(instanceName);
}

/**
 * DELETE /instance/delete/:instance
 */
export async function deleteInstance(instanceName) {
  const baseUrl = getBaseUrl();
  const enc = encodeURIComponent(instanceName);
  const path = `/instance/delete/${enc}`;
  console.log('[evolution] deleteInstance', instanceName);
  const { data } = await axios.delete(`${baseUrl}${path}`, opts());
  console.log('[evolution] deleteInstance OK', instanceName);
  return data;
}

export async function sendText(instance, number, text) {
  const EVOLUTION_URL = process.env.EVOLUTION_URL;
  const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY;

  if (!EVOLUTION_URL || !EVOLUTION_API_KEY) {
    throw new Error('EVOLUTION_URL and EVOLUTION_API_KEY must be set');
  }

  let instanceEncoded = instance;
  if (/%[0-9A-Fa-f]{2}/.test(instance)) {
    try {
      instanceEncoded = decodeURIComponent(instance);
    } catch {
      // keep as-is
    }
  }
  instanceEncoded = encodeURIComponent(instanceEncoded);

  const url = `${EVOLUTION_URL.replace(/\/$/, '')}/message/sendText/${instanceEncoded}`;

  await axios.post(
    url,
    { number, text },
    {
      headers: { apikey: EVOLUTION_API_KEY },
      timeout: 15000,
    }
  );
}
