/**
 * Envio de texto WhatsApp conforme provider do canal (Evolution vs WAHA).
 */

import * as evolutionService from './evolutionService.js';
import * as wahaService from './wahaService.js';
import { resolveSessionName } from '../utils/resolveSessionName.js';

/**
 * @param {object} channel - linha channels (precisa external_id / provider)
 * @param {string} number - dígitos E.164 ou local
 * @param {string} text
 */
export async function sendWhatsAppTextForChannel(channel, number, text) {
  const provider = String(channel?.provider || '').toLowerCase();

  if (provider === 'waha') {
    const sessionName = resolveSessionName(channel);
    const out = await wahaService.sendMessage(sessionName, number, text);
    if (!out.ok) throw new Error(out.error || 'Falha no envio WAHA');
    return out.data;
  }

  const instance =
    channel?.external_id != null && String(channel.external_id).trim() !== ''
      ? String(channel.external_id).trim()
      : channel?.instance != null
        ? String(channel.instance).trim()
        : '';

  if (!instance) {
    throw new Error('Canal sem sessão/instância (external_id) para envio.');
  }

  return evolutionService.sendText(instance, number, text);
}
