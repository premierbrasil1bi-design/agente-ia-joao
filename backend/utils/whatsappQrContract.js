/** Marcador para detecção estável em normalizeQrResult (evita colisão com objetos arbitrários). */
export const WHATSAPP_UNIFIED_QR_KIND = 'whatsapp.unified_qr_v1';

/**
 * Contrato unificado de resposta de QR (REST | stream | logs | cache).
 * Formato canônico: `{ success, session, provider, state, qr, format, source, error, meta, correlationId }` + `__kind` / `__contractVersion`.
 * Compatível com normalizeQrResult (success/format/qr/message) e campos legados qrCode/qrcode.
 *
 * @typedef {object} UnifiedQrResponse
 * @property {boolean} success
 * @property {string|null} session
 * @property {string|null} provider
 * @property {string|null} state — SessionState ou equivalente agnóstico
 * @property {string|null} qr
 * @property {'image'|'ascii'|'base64'|null} format
 * @property {'rest'|'stream'|'logs'|'cache'|null} source
 * @property {string|null} error
 * @property {Record<string, unknown>} meta
 */

/**
 * @param {object} p
 * @returns {UnifiedQrResponse & { message?: string, qrCode?: string, qrcode?: string }}
 */
export function buildUnifiedQrResponse(p) {
  const success = Boolean(p.success);
  const format = p.format ?? null;
  const qr = p.qr ?? null;

  const out = {
    success,
    session: p.session != null ? String(p.session) : null,
    provider: p.provider != null ? String(p.provider) : null,
    state: p.state != null ? String(p.state) : null,
    qr,
    format,
    source: p.source ?? null,
    error: p.error != null ? String(p.error) : null,
    meta: p.meta && typeof p.meta === 'object' && !Array.isArray(p.meta) ? { ...p.meta } : {},
  };

  if (p.message != null && p.message !== '') {
    out.message = String(p.message);
  }

  if (success && format === 'image' && qr) {
    out.qrCode = qr;
    out.qrcode = qr;
  }

  return out;
}

/**
 * Campos extras do contrato unificado para incluir em REST/socket sem quebrar payloads legados.
 * @param {Record<string, unknown>|null|undefined} result — típico retorno de normalizeQrResult após QR WAHA unificado
 * @returns {{ session?: string|null, provider?: string|null, state?: string|null, source?: string|null, error?: string|null, meta?: Record<string, unknown> }}
 */
export function pickUnifiedQrTransportFields(result) {
  if (!result || typeof result !== 'object') return {};
  const keys = ['session', 'provider', 'state', 'source', 'error', 'meta', 'correlationId'];
  /** @type {Record<string, unknown>} */
  const o = {};
  for (const k of keys) {
    if (k in result && result[k] !== undefined) o[k] = result[k];
  }
  return o;
}
