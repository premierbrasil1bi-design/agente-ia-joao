/**
 * Logs estruturados para orquestração de sessão WhatsApp (produção / correlação).
 * Encaminha para {@link ./whatsappSessionLogger.js} (JSON por linha, campos padronizados).
 */

import { whatsappLogger } from './whatsappSessionLogger.js';

export function logWhatsappSession(payload) {
  const p = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  whatsappLogger.info('whatsapp_session_event', p);
}
