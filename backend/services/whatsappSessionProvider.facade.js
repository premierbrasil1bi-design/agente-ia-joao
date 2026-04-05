/**
 * Fachada genérica de sessão WhatsApp (connect / status / QR / ensure).
 * Hoje implementa WAHA; Evolution/Zapi entram aqui incrementalmente.
 */

import { connectWahaChannel, ensureWahaSessionPrepared } from './whatsappSessionOrchestrator.service.js';
import { extractStatusFromSessionEntry } from './wahaSession.adapter.js';
import { SessionState, normalizeProviderSessionStatus } from './whatsapp/whatsappSessionState.js';
import { createSessionOpError, SessionOpErrorCode } from './whatsapp/whatsappSessionErrors.js';
import { buildCanonicalStatusResult } from '../utils/whatsappCanonicalContracts.js';
import { ensureCorrelationId } from '../utils/correlationId.js';
import { executeWithProviderFallback } from './whatsapp/providerFallback.service.js';

const WAHA = 'waha';
const EVOLUTION = 'evolution';

function stripProviders(ctx) {
  const { providers: _p, ...rest } = ctx || {};
  return rest;
}

/**
 * @param {string} provider
 * @param {{ sessionName: string, tenantId?: string|null, channelId?: string|null, correlationId?: string|null, pollMs?: number, timeoutMs?: number }} ctx
 */
export async function ensureProviderSessionPrepared(provider, ctx) {
  const p = String(provider || '').toLowerCase().trim();
  if (p === WAHA) {
    return ensureWahaSessionPrepared(ctx);
  }
  throw createSessionOpError(
    SessionOpErrorCode.PROVIDER_UNAVAILABLE,
    `ensureProviderSessionPrepared não implementado para provider: ${p}`,
    { provider: p, correlationId: ctx.correlationId ?? null },
  );
}

/**
 * @param {string} provider
 * @param {{ sessionName: string, tenantId?: string|null, channelId?: string|null, correlationId?: string|null, providers?: string[] }} ctx
 */
export async function connectProviderSessionDirect(provider, ctx) {
  const p = String(provider || '').toLowerCase().trim();
  if (p === WAHA) {
    return connectWahaChannel(ctx);
  }
  throw createSessionOpError(
    SessionOpErrorCode.PROVIDER_UNAVAILABLE,
    `connectProviderSession não implementado para provider: ${p}`,
    { provider: p, correlationId: ctx.correlationId ?? null },
  );
}

/**
 * @param {string} provider
 * @param {{ sessionName: string, tenantId?: string|null, channelId?: string|null, correlationId?: string|null, providers?: string[] }} ctx
 */
export async function connectProviderSession(provider, ctx) {
  const list = ctx?.providers;
  if (Array.isArray(list) && list.length > 0) {
    const base = stripProviders(ctx);
    return executeWithProviderFallback(
      (p) => connectProviderSessionDirect(p, base),
      { ...ctx, providers: list },
    );
  }
  return connectProviderSessionDirect(provider, ctx);
}

/**
 * @param {string} provider
 * @param {string} sessionName
 * @param {{ tenantId?: string|null, channelId?: string|null, correlationId?: string|null, providers?: string[] }} [ctx]
 */
export async function getProviderQrCodeDirect(provider, sessionName, ctx = {}) {
  const p = String(provider || '').toLowerCase().trim();
  if (p === WAHA) {
    const wahaService = await import('./wahaService.js');
    return wahaService.getQrCodeOperationResult(sessionName, ctx);
  }
  throw createSessionOpError(
    SessionOpErrorCode.PROVIDER_UNAVAILABLE,
    `getProviderQrCode não implementado para provider: ${p}`,
    { provider: p, correlationId: ctx.correlationId ?? null },
  );
}

/**
 * @param {string} provider
 * @param {string} sessionName
 * @param {{ tenantId?: string|null, channelId?: string|null, correlationId?: string|null, providers?: string[] }} [ctx]
 */
export async function getProviderQrCode(provider, sessionName, ctx = {}) {
  const list = ctx?.providers;
  if (Array.isArray(list) && list.length > 0) {
    const base = stripProviders(ctx);
    return executeWithProviderFallback(
      (p) => getProviderQrCodeDirect(p, sessionName, base),
      { ...ctx, providers: list },
    );
  }
  return getProviderQrCodeDirect(provider, sessionName, ctx);
}

/**
 * @param {string} provider
 * @param {string} sessionName
 * @param {{ tenantId?: string|null, channelId?: string|null, correlationId?: string|null, providers?: string[] }} [ctx]
 * @returns {Promise<ReturnType<typeof buildCanonicalStatusResult>>}
 */
export async function getProviderSessionStatusDirect(provider, sessionName, ctx = {}) {
  const p = String(provider || '').toLowerCase().trim();
  const correlationId = ensureCorrelationId(ctx.correlationId);

  if (p === WAHA) {
    const wahaService = await import('./wahaService.js');
    const st = await wahaService.getSessionStatus(sessionName, ctx);
    if (!st.ok) {
      return buildCanonicalStatusResult({
        success: false,
        provider: WAHA,
        session: String(sessionName),
        state: SessionState.UNKNOWN,
        connected: false,
        rawStatus: null,
        correlationId,
        error: st.error || 'WAHA status failed',
        meta: {
          httpStatus: st.httpStatus ?? null,
          code: st.code ?? null,
        },
      });
    }

    const legacy = st.data;
    const raw =
      extractStatusFromSessionEntry(legacy) ??
      (legacy && typeof legacy === 'object' ? legacy.status ?? legacy.state : null) ??
      null;
    const internal = normalizeProviderSessionStatus(WAHA, raw);

    return buildCanonicalStatusResult({
      success: true,
      provider: WAHA,
      session: String(sessionName),
      normalizedState: internal,
      state: internal,
      rawStatus: raw != null ? String(raw) : null,
      correlationId,
      error: null,
      meta: { legacyPayload: legacy },
    });
  }

  if (p === EVOLUTION) {
    const evolutionService = await import('./evolutionService.js');
    try {
      const data = await evolutionService.getConnectionStatus(sessionName);
      const rawStatus =
        data && typeof data === 'object'
          ? data.status ?? data.state ?? data.instance?.state ?? null
          : null;
      const rawStr = rawStatus != null ? String(rawStatus) : null;
      return buildCanonicalStatusResult({
        success: true,
        provider: EVOLUTION,
        session: String(sessionName),
        rawStatus: rawStr,
        correlationId,
        error: null,
        meta: {},
      });
    } catch (e) {
      return buildCanonicalStatusResult({
        success: false,
        provider: EVOLUTION,
        session: String(sessionName),
        rawStatus: null,
        correlationId,
        error: e?.message != null ? String(e.message) : 'Evolution status failed',
        meta: {
          code: e && typeof e === 'object' && 'code' in e ? e.code : undefined,
        },
      });
    }
  }

  throw createSessionOpError(
    SessionOpErrorCode.PROVIDER_UNAVAILABLE,
    `getProviderSessionStatus não implementado para provider: ${p}`,
    { provider: p, correlationId },
  );
}

/**
 * @param {string} provider
 * @param {string} sessionName
 * @param {{ tenantId?: string|null, channelId?: string|null, correlationId?: string|null, providers?: string[] }} [ctx]
 * @returns {Promise<ReturnType<typeof buildCanonicalStatusResult> & { providerUsed?: string }>}
 */
export async function getProviderSessionStatus(provider, sessionName, ctx = {}) {
  const list = ctx?.providers;
  if (Array.isArray(list) && list.length > 0) {
    const base = stripProviders(ctx);
    return executeWithProviderFallback(
      (p) => getProviderSessionStatusDirect(p, sessionName, base),
      { ...ctx, providers: list },
    );
  }
  return getProviderSessionStatusDirect(provider, sessionName, ctx);
}
