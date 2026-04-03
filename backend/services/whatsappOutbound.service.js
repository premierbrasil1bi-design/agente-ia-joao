/**
 * Envio de texto WhatsApp resiliente via orchestrator multi-provider.
 */
import { sendMessageWithFallback } from './providerOrchestrator.service.js';

/**
 * @param {object} channel - linha channels (precisa external_id / provider)
 * @param {string} number - dígitos E.164 ou local
 * @param {string} text
 */
export async function sendWhatsAppTextForChannel(channel, number, text) {
  const result = await sendMessageWithFallback(channel, {
    number,
    text,
  });
  return result?.data ?? null;
}
