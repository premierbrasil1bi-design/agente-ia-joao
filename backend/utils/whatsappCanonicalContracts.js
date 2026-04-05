/**
 * Contratos canônicos internos (CONNECT / STATUS / QR) — campos estáveis para REST/socket/serviços.
 * Adaptadores de saída podem acrescentar qrCode/qrcode etc. sem mudar o núcleo.
 */

import crypto from 'crypto';

/**
 * @param {unknown} payload
 * @returns {unknown}
 */
function safeLimitPayload(payload) {
  try {
    const str = JSON.stringify(payload);
    if (str.length > 5000) {
      return { truncated: true };
    }
    return payload;
  } catch {
    return { invalid: true };
  }
}

/**
 * @param {object} p
 * @returns {{
 *   success: boolean,
 *   provider: string,
 *   session: string,
 *   connected: boolean,
 *   state: string,
 *   prepare?: { state: string, attempts?: number, durationMs?: number, rawStatus?: string|null, waitAttempts?: number },
 *   correlationId: string,
 *   error?: string|null,
 *   meta?: Record<string, unknown>|null
 * }}
 */
export function buildCanonicalConnectResult(p) {
  const prepare = p.prepare && typeof p.prepare === 'object' ? p.prepare : null;
  const slimPrepare = prepare
    ? {
        state: String(prepare.state ?? ''),
        ...(prepare.waitAttempts != null ? { attempts: prepare.waitAttempts } : {}),
        ...(prepare.attempts != null ? { attempts: prepare.attempts } : {}),
        ...(prepare.durationMs != null ? { durationMs: prepare.durationMs } : {}),
        ...(prepare.rawStatus !== undefined ? { rawStatus: prepare.rawStatus } : {}),
      }
    : undefined;

  return {
    success: Boolean(p.success),
    provider: String(p.provider ?? ''),
    session: String(p.session ?? ''),
    connected: Boolean(p.connected),
    state: String(p.state ?? ''),
    ...(slimPrepare && Object.keys(slimPrepare).length ? { prepare: slimPrepare } : {}),
    correlationId: String(p.correlationId ?? ''),
    error: p.error != null ? String(p.error) : null,
    meta: p.meta && typeof p.meta === 'object' && !Array.isArray(p.meta) ? p.meta : null,
  };
}

/**
 * Contrato canônico STATUS (ponta a ponta).
 *
 * @param {object} p
 * @param {string} [p.normalizedState]
 * @param {{ correlationId?: string|null }} [ctx]
 * @returns {{
 *   success: boolean,
 *   provider: string,
 *   session: string,
 *   state: string,
 *   connected: boolean,
 *   rawStatus: string|null,
 *   correlationId: string,
 *   error: string|null,
 *   meta: Record<string, unknown>
 * }}
 */
export function buildCanonicalStatusResult(p, ctx = {}) {
  const rawOut =
    p.rawStatus === undefined || p.rawStatus === null
      ? null
      : typeof p.rawStatus === 'string'
        ? p.rawStatus
        : String(p.rawStatus);

  const normalizedState =
    p.normalizedState !== undefined && p.normalizedState !== null
      ? String(p.normalizedState).trim()
      : '';
  const state =
    p.state !== undefined && p.state !== null ? String(p.state).trim() : '';
  const rawStatus =
    rawOut === null || rawOut === undefined ? '' : String(rawOut).trim();

  const safeState = normalizedState || state || rawStatus || 'UNKNOWN';
  const safeStateUpper = String(safeState).toUpperCase();

  const connected =
    safeStateUpper === 'CONNECTED' ||
    safeStateUpper === 'OPEN' ||
    safeStateUpper === 'WORKING';

  const provider = String(p.provider ?? '');

  const fromCtx =
    ctx?.correlationId != null && String(ctx.correlationId).trim() !== ''
      ? String(ctx.correlationId).trim()
      : '';
  const fromP =
    p.correlationId != null && String(p.correlationId).trim() !== ''
      ? String(p.correlationId).trim()
      : '';
  const correlationId = fromCtx || fromP || crypto.randomUUID();

  if (process.env.NODE_ENV !== 'production') {
    console.log('[STATUS][CANONICAL]', {
      provider,
      state: safeState,
      connected,
      correlationId,
    });
  }

  const baseMeta =
    p.meta && typeof p.meta === 'object' && !Array.isArray(p.meta) ? { ...p.meta } : {};
  const meta =
    Object.prototype.hasOwnProperty.call(baseMeta, 'legacyPayload')
      ? { ...baseMeta, legacyPayload: safeLimitPayload(baseMeta.legacyPayload) }
      : baseMeta;

  return {
    success: Boolean(p.success),
    provider,
    session: String(p.session ?? ''),
    state: safeState,
    connected: Boolean(connected),
    rawStatus: rawOut,
    correlationId,
    error: p.error != null ? String(p.error) : null,
    meta,
  };
}
