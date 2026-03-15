/**
 * Evolution API 2.2.x – serviço centralizado para WhatsApp (WHATSAPP-BAILEYS).
 * Headers: apikey (EVOLUTION_API_KEY) e Content-Type em todas as chamadas.
 * Retry: máx 3 tentativas, delay 500ms.
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

const opts = () => ({ timeout: 15000, headers: getHeaders() });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executa request com retry (máx 3 tentativas, delay 500ms).
 */
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
 * Cria uma instância na Evolution API 2.2.x.
 * POST /instance/create
 * Body: { instanceName, integration: "WHATSAPP-BAILEYS" }
 */
export async function createInstance(instanceName) {
  const baseUrl = getBaseUrl();
  return withRetry(
    () =>
      axios.post(
        `${baseUrl}/instance/create`,
        { instanceName, integration: 'WHATSAPP-BAILEYS' },
        opts()
      ).then((r) => r.data),
    'createInstance',
    instanceName
  );
}

/**
 * Inicia conexão e gera QR Code.
 * GET /instance/connect/:instance
 */
export async function connectInstance(instanceName) {
  const baseUrl = getBaseUrl();
  return withRetry(
    () =>
      axios.get(`${baseUrl}/instance/connect/${encodeURIComponent(instanceName)}`, opts()).then((r) => r.data),
    'connectInstance',
    instanceName
  );
}

/**
 * Alias para connectInstance (compatibilidade).
 */
export async function getQrCode(instanceName) {
  return connectInstance(instanceName);
}

/**
 * Estado da conexão da instância.
 * GET /instance/connectionState/:instance
 */
export async function getConnectionStatus(instanceName) {
  const baseUrl = getBaseUrl();
  return withRetry(
    () =>
      axios.get(
        `${baseUrl}/instance/connectionState/${encodeURIComponent(instanceName)}`,
        opts()
      ).then((r) => r.data),
    'getConnectionStatus',
    instanceName
  );
}

/**
 * Alias para getConnectionStatus (compatibilidade).
 */
export async function getInstanceStatus(instanceName) {
  return getConnectionStatus(instanceName);
}

/**
 * Desconecta a sessão (logout) – Evolution 2.2.x.
 * DELETE /instance/logout/:instance
 */
export async function disconnectInstance(instanceName) {
  const baseUrl = getBaseUrl();
  return withRetry(
    () =>
      axios.delete(
        `${baseUrl}/instance/logout/${encodeURIComponent(instanceName)}`,
        opts()
      ).then((r) => r.data),
    'disconnectInstance',
    instanceName
  );
}

/**
 * Send a text message via Evolution API.
 *
 * @param {string} instance - Evolution instance name (will be encoded for URL).
 * @param {string} number - Destination number (e.g. 5588999999999 or 5588999999999@s.whatsapp.net).
 * @param {string} text - Message text to send.
 * @returns {Promise<void>} Resolves when sent; throws on failure.
 */
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
