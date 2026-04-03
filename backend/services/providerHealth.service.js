/**
 * Healthcheck com cache curto (10s) para não sobrecarregar APIs externas.
 */

import { config } from '../config/env.js';
import * as evolutionService from './evolutionService.js';
import { wahaRequest, validateWahaEnv } from './wahaHttp.js';
import { logAdminAction } from './adminActionsLog.service.js';

const CACHE_TTL_MS = 10_000;
const CIRCUIT_OPEN_MS = 30_000;
const AUTO_RECONNECT_COOLDOWN_MS = 60_000;

/** @type {Map<string, { at: number, error: Error | null }>} */
const healthCache = new Map();
/** @type {Map<string, { failures: number, lastFailureAt: string | null, lastCheckAt: string | null, latencyMs: number | null, status: 'ok' | 'degraded' | 'down', message: string | null, circuitOpenUntil: number | null, retryCount: number, nextRetryAt: string | null, lastAutoReconnectAt: string | null }>} */
const providerState = new Map();
/** @type {Map<string, number>} */
const lastAutoReconnectAt = new Map();
/** @type {Set<string>} */
const autoReconnectInFlight = new Set();

function getConfiguredProviders() {
  return Object.keys(config.providers || {});
}

function ensureProviderState(provider) {
  if (!providerState.has(provider)) {
    providerState.set(provider, {
      failures: 0,
      lastFailureAt: null,
      lastCheckAt: null,
      latencyMs: null,
      status: 'ok',
      message: null,
      circuitOpenUntil: null,
      retryCount: 0,
      nextRetryAt: null,
      lastAutoReconnectAt: null,
    });
  }
  return providerState.get(provider);
}

function getCached(provider, now) {
  const cached = healthCache.get(provider);
  if (!cached) return null;
  if (now - cached.at >= CACHE_TTL_MS) return null;
  return cached;
}

function setCached(provider, error = null) {
  healthCache.set(provider, { at: Date.now(), error });
}

async function checkWaha() {
  try {
    validateWahaEnv();
  } catch (e) {
    const err = new Error('WAHA não configurado (WAHA_API_URL / WAHA_API_KEY).');
    err.code = 'WAHA_UNREACHABLE';
    throw err;
  }
  try {
    await wahaRequest('GET', '/api/sessions');
  } catch (error) {
    if (error.httpStatus === 401) {
      const e = new Error('WAHA: não autorizado (verifique WAHA_API_KEY).');
      e.httpStatus = 401;
      throw e;
    }
    const e = new Error('WAHA não acessível');
    e.code = 'WAHA_UNREACHABLE';
    e.cause = error;
    throw e;
  }
}

async function checkEvolution() {
  const url = String(config.providers?.evolution?.url || '').trim();
  if (!url) {
    const e = new Error('Evolution não configurado (EVOLUTION_API_URL ausente).');
    e.code = 'EVOLUTION_NOT_CONFIGURED';
    throw e;
  }
  await evolutionService.checkEvolutionHealth();
}

function computeStatus(failures) {
  if (failures >= 3) return 'down';
  if (failures >= 1) return 'degraded';
  return 'ok';
}

function emitStatusChange(provider, from, to) {
  if (from === to) return;
  console.log('[PROVIDER STATUS CHANGE]', {
    provider,
    from,
    to,
  });
  notifyProviderStatusChange(provider, from, to).catch(() => {
    // alerta externo não pode quebrar fluxo
  });
  logAdminAction({
    action: 'PROVIDER_ALERT',
    entity: 'provider',
    entityId: provider,
    metadata: { provider, from, to, timestamp: new Date().toISOString() },
    performedBy: null,
    role: 'SYSTEM',
    status: 'success',
    message: null,
  });
}

function markSuccess(provider, latencyMs) {
  const st = ensureProviderState(provider);
  const prev = st.status;
  st.failures = 0;
  st.lastFailureAt = null;
  st.lastCheckAt = new Date().toISOString();
  st.latencyMs = latencyMs;
  st.status = 'ok';
  st.message = null;
  st.circuitOpenUntil = null;
  st.retryCount = 0;
  st.nextRetryAt = null;
  emitStatusChange(provider, prev, st.status);
}

function markFailure(provider, error, latencyMs) {
  const st = ensureProviderState(provider);
  const prev = st.status;
  st.failures += 1;
  st.lastFailureAt = new Date().toISOString();
  st.lastCheckAt = new Date().toISOString();
  st.latencyMs = latencyMs;
  st.status = computeStatus(st.failures);
  st.message = error?.message || 'Provider indisponível';
  emitStatusChange(provider, prev, st.status);
}

function getBackoffDelay(retryCount) {
  if (retryCount <= 1) return 60_000;
  if (retryCount === 2) return 120_000;
  return 300_000;
}

async function notifyProviderStatusChange(provider, from, to) {
  const webhook = String(process.env.ALERT_WEBHOOK_URL || '').trim();
  if (!webhook) return;
  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider,
        from,
        to,
        timestamp: new Date().toISOString(),
      }),
    });
  } catch {
    // webhook best-effort
  }
}

async function runProviderProbe(provider) {
  if (provider === 'waha') {
    await checkWaha();
    return;
  }
  if (provider === 'evolution') {
    await checkEvolution();
    return;
  }
  throw new Error(`Health check não implementado para provider: ${provider}`);
}

async function tryAutoReconnect(provider) {
  const st = ensureProviderState(provider);
  if (st.status !== 'down' || st.failures < 3) return;
  if (st.circuitOpenUntil && Date.now() < st.circuitOpenUntil) return;
  if (st.nextRetryAt) {
    const nextTs = new Date(st.nextRetryAt).getTime();
    if (Number.isFinite(nextTs) && Date.now() < nextTs) return;
  }
  if (autoReconnectInFlight.has(provider)) return;

  const lastRun = lastAutoReconnectAt.get(provider) || 0;
  if (Date.now() - lastRun < AUTO_RECONNECT_COOLDOWN_MS) return;

  autoReconnectInFlight.add(provider);
  lastAutoReconnectAt.set(provider, Date.now());

  st.lastAutoReconnectAt = new Date().toISOString();
  st.retryCount = Number(st.retryCount || 0) + 1;
  const delayMs = getBackoffDelay(st.retryCount);
  st.nextRetryAt = new Date(Date.now() + delayMs).toISOString();

  try {
    invalidateProviderHealthCache(provider);
    await runProviderProbe(provider);
    markSuccess(provider, 0);
    await logAdminAction({
      action: 'PROVIDER_AUTO_RECONNECT',
      entity: 'provider',
      entityId: provider,
      metadata: {
        provider,
        mode: 'auto',
        timestamp: new Date().toISOString(),
        retryCount: st.retryCount,
        delayMs,
      },
      performedBy: null,
      role: 'SYSTEM',
      status: 'success',
      message: 'Auto reconnect concluído',
    });
  } catch (err) {
    await logAdminAction({
      action: 'PROVIDER_AUTO_RECONNECT',
      entity: 'provider',
      entityId: provider,
      metadata: {
        provider,
        mode: 'auto',
        timestamp: new Date().toISOString(),
        retryCount: st.retryCount,
        delayMs,
      },
      performedBy: null,
      role: 'SYSTEM',
      status: 'error',
      message: err?.message || 'Auto reconnect falhou',
    });
  } finally {
    autoReconnectInFlight.delete(provider);
  }
}

function maybeShortCircuit(provider) {
  const st = ensureProviderState(provider);
  if (st.status === 'down' && st.circuitOpenUntil && Date.now() < st.circuitOpenUntil) {
    const err = new Error('Provider em circuit open (aguardando retry).');
    err.code = 'CIRCUIT_OPEN';
    err.provider = provider;
    throw err;
  }
}

/**
 * @param {string} provider - ex.: 'waha'
 * @returns {Promise<boolean>}
 */
export async function checkProviderHealth(provider) {
  const p = String(provider || '').toLowerCase().trim();
  ensureProviderState(p);
  maybeShortCircuit(p);
  const now = Date.now();
  const cached = getCached(p, now);
  if (cached) {
    if (cached.error) throw cached.error;
    return true;
  }
  const startedAt = Date.now();

  try {
    if (p === 'waha') {
      console.log('[PROVIDER HEALTH] check', { provider: 'waha', url: config.providers.waha.url });
      await checkWaha();
      setCached(p, null);
      markSuccess(p, Date.now() - startedAt);
      return true;
    }
    if (p === 'evolution') {
      console.log('[PROVIDER HEALTH] check', { provider: 'evolution', url: config.providers.evolution.url || null });
      await checkEvolution();
      setCached(p, null);
      markSuccess(p, Date.now() - startedAt);
      return true;
    }
    throw new Error(`Health check não implementado para provider: ${provider}`);
  } catch (err) {
    if (p === 'waha') {
      const c = err.code;
      if (c === 'ECONNREFUSED' || c === 'ENOTFOUND' || c === 'ETIMEDOUT' || c === 'ECONNABORTED') {
        const e = new Error('WAHA não acessível');
        e.code = 'WAHA_UNREACHABLE';
        e.cause = err;
        setCached(p, e);
        markFailure(p, e, Date.now() - startedAt);
        throw e;
      }
      console.error('[WAHA ERROR]:', err.response?.data || err.message);
    } else if (p === 'evolution') {
      console.error('[EVOLUTION ERROR]:', err.response?.data || err.message);
    } else {
      console.error('[PROVIDER HEALTH ERROR]:', err.message);
    }
    setCached(p, err);
    markFailure(p, err, Date.now() - startedAt);
    const stAfter = ensureProviderState(p);
    if (stAfter.status === 'down' && !(stAfter.circuitOpenUntil && Date.now() < stAfter.circuitOpenUntil)) {
      await tryAutoReconnect(p);
      const stFinal = ensureProviderState(p);
      if (stFinal.status === 'down') {
        stFinal.circuitOpenUntil = Date.now() + CIRCUIT_OPEN_MS;
      }
    }
    throw err;
  }
}

export async function getProvidersHealthSnapshot(providers = getConfiguredProviders()) {
  const out = {};
  for (const provider of providers) {
    const startedAt = Date.now();
    try {
      await checkProviderHealth(provider);
      const st = ensureProviderState(provider);
      out[provider] = {
        status: st.status,
        latencyMs: st.latencyMs ?? Date.now() - startedAt,
        lastCheckAt: st.lastCheckAt,
        consecutiveFailures: st.failures,
        message: st.message,
        retryCount: st.retryCount ?? 0,
        lastAutoReconnectAt: st.lastAutoReconnectAt ?? null,
        nextRetryInMs: st.nextRetryAt ? Math.max(0, new Date(st.nextRetryAt).getTime() - Date.now()) : null,
      };
    } catch (err) {
      const st = ensureProviderState(provider);
      out[provider] = {
        status: st.status || 'down',
        latencyMs: st.latencyMs ?? Date.now() - startedAt,
        lastCheckAt: st.lastCheckAt,
        consecutiveFailures: st.failures,
        message: st.message || err?.message || 'Provider indisponível',
        retryCount: st.retryCount ?? 0,
        lastAutoReconnectAt: st.lastAutoReconnectAt ?? null,
        nextRetryInMs: st.nextRetryAt ? Math.max(0, new Date(st.nextRetryAt).getTime() - Date.now()) : null,
      };
    }
  }
  return out;
}

/**
 * Seleciona provider saudável para failover.
 * Prioriza o provider preferido; se indisponível, tenta os demais em sequência.
 * @param {string} preferred
 * @returns {Promise<string>}
 */
export async function getHealthyProvider(preferred) {
  const preferredNorm = String(preferred || '').toLowerCase().trim();
  const providers = getConfiguredProviders();
  const ordered = [
    ...(preferredNorm ? [preferredNorm] : []),
    ...providers.filter((p) => p !== preferredNorm),
  ];
  for (const provider of ordered) {
    try {
      await checkProviderHealth(provider);
      return provider;
    } catch {
      // tenta próximo provider
    }
  }
  throw new Error('Nenhum provider saudável disponível para failover.');
}

export function invalidateProviderHealthCache(provider) {
  const p = String(provider || '').toLowerCase().trim();
  if (!p) return;
  healthCache.delete(p);
  providerState.delete(p);
}
