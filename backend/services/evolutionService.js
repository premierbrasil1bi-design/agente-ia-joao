/**
 * Evolution API – send messages to WhatsApp e gestão de instâncias.
 * Reusable channel sender for the message pipeline.
 * Headers: apikey (EVOLUTION_API_KEY) em todas as chamadas.
 */

import axios from 'axios';

const getBaseUrl = () => {
  const url = process.env.EVOLUTION_API_URL || process.env.EVOLUTION_URL;
  if (!url) throw new Error('EVOLUTION_API_URL ou EVOLUTION_URL deve estar definida.');
  return url.replace(/\/$/, '');
};

const getApiKey = () => process.env.EVOLUTION_API_KEY || '';

const evolutionHeaders = () => {
  const apikey = getApiKey();
  const headers = { 'Content-Type': 'application/json' };
  if (apikey) headers.apikey = apikey;
  return headers;
};

/**
 * Cria uma instância na Evolution API.
 * POST /instance/create
 * Body: { instanceName, qrcode: true }
 */
export async function createInstance(instanceName) {
  const baseUrl = getBaseUrl();
  const { data } = await axios.post(
    `${baseUrl}/instance/create`,
    { instanceName, qrcode: true },
    { timeout: 15000, headers: evolutionHeaders() }
  );
  return data;
}

/**
 * Obtém QR Code para conexão.
 * GET /instance/connect/{instanceName}
 * Resposta retorna QR Code base64.
 */
export async function getQrCode(instanceName) {
  const baseUrl = getBaseUrl();
  const { data } = await axios.get(
    `${baseUrl}/instance/connect/${encodeURIComponent(instanceName)}`,
    { timeout: 15000, headers: evolutionHeaders() }
  );
  return data;
}

/**
 * Obtém estado da conexão da instância.
 * GET /instance/connectionState/{instanceName}
 */
export async function getInstanceStatus(instanceName) {
  const baseUrl = getBaseUrl();
  const { data } = await axios.get(
    `${baseUrl}/instance/connectionState/${encodeURIComponent(instanceName)}`,
    { timeout: 15000, headers: evolutionHeaders() }
  );
  return data;
}

/**
 * Remove/desconecta instância.
 * DELETE /instance/delete/{instanceName}
 */
export async function disconnectInstance(instanceName) {
  const baseUrl = getBaseUrl();
  const { data } = await axios.delete(
    `${baseUrl}/instance/delete/${encodeURIComponent(instanceName)}`,
    { timeout: 15000, headers: evolutionHeaders() }
  );
  return data;
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
