/**
 * Contrato interno desejado para providers de sessão WhatsApp (JSDoc — projeto em JS).
 * WAHA implementa via orquestrador + adapter; Evolution/Zapi podem aderir incrementalmente.
 *
 * @typedef {object} WhatsappSessionContext
 * @property {string|null} [tenantId]
 * @property {string|null} [channelId]
 * @property {string|null} [correlationId]
 *
 * @typedef {object} IWhatsAppSessionProvider
 * @property {string} name
 * @property {(ctx: WhatsappSessionContext) => Promise<{ success: boolean, provider: string, status: 'healthy'|'degraded'|'unhealthy', latencyMs?: number, correlationId: string, error?: string|null, meta?: object|null }>} [getHealth]
 * @property {(session: string, ctx: WhatsappSessionContext) => Promise<object>} [getSessionStatus]
 * @property {(session: string, ctx: WhatsappSessionContext) => Promise<object>} [createSession]
 * @property {(session: string, ctx: WhatsappSessionContext) => Promise<object>} [startSession]
 * @property {(session: string, ctx: WhatsappSessionContext) => Promise<object>} [getQrCode]
 * @property {(session: string, ctx: WhatsappSessionContext) => Promise<object>} [connect]
 * @property {(rawStatus: unknown) => string} [normalizeStatus]
 *
 * Fachadas em `services/whatsappSessionProvider.facade.js` (implementação WAHA primeiro):
 * - connectProviderSession(provider, ctx)
 * - getProviderSessionStatus(provider, session, ctx)
 * - getProviderQrCode(provider, session, ctx)
 * - ensureProviderSessionPrepared(provider, ctx)
 */

export const WHATSAPP_SESSION_CONTRACT_VERSION = 1;
