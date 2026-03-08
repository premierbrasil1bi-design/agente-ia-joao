/**
 * Evolution API – send messages to WhatsApp.
 * Reusable channel sender for the message pipeline.
 */

import axios from 'axios';

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
