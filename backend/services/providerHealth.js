import { log } from '../utils/logger.js';
import { getMessageStats } from './messageRegistry.js';
const providerState = new Map();
const providerMetrics = new Map();

const FAILURE_THRESHOLD = 5;
const OPEN_WINDOW_MS = 30_000;

function now() {
  return Date.now();
}

function getState(provider) {
  const key = String(provider || 'unknown').toLowerCase();
  if (!providerState.has(key)) {
    providerState.set(key, {
      state: 'CLOSED',
      failureCount: 0,
      lastFailure: 0,
      halfOpenInFlight: false,
    });
  }
  return providerState.get(key);
}

export function canAttempt(provider) {
  const st = getState(provider);
  if (st.state === 'CLOSED') return true;
  if (st.state === 'OPEN') {
    if (now() - st.lastFailure >= OPEN_WINDOW_MS) {
      st.state = 'HALF_OPEN';
      st.halfOpenInFlight = false;
      log.warn({
        event: 'CIRCUIT_HALF_OPEN',
        context: 'provider',
        provider: String(provider || 'unknown').toLowerCase(),
        metadata: { failureCount: st.failureCount },
      });
      return true;
    }
    return false;
  }
  // HALF_OPEN: permite somente 1 tentativa de teste por vez
  if (st.halfOpenInFlight) return false;
  st.halfOpenInFlight = true;
  return true;
}

export function markSuccess(provider) {
  const st = getState(provider);
  const wasOpen = st.state !== 'CLOSED';
  st.state = 'CLOSED';
  st.failureCount = 0;
  st.halfOpenInFlight = false;
  if (wasOpen) {
    log.info({
      event: 'CIRCUIT_CLOSED',
      context: 'provider',
      provider: String(provider || 'unknown').toLowerCase(),
    });
  }
}

export function markFailure(provider) {
  const st = getState(provider);
  st.failureCount += 1;
  st.lastFailure = now();
  st.halfOpenInFlight = false;
  if (st.failureCount > FAILURE_THRESHOLD) {
    st.state = 'OPEN';
    log.error({
      event: 'CIRCUIT_OPENED',
      context: 'provider',
      provider: String(provider || 'unknown').toLowerCase(),
      metadata: { failureCount: st.failureCount, openWindowMs: OPEN_WINDOW_MS },
    });
    return;
  }
  if (st.state === 'HALF_OPEN') {
    st.state = 'OPEN';
    log.error({
      event: 'CIRCUIT_OPENED',
      context: 'provider',
      provider: String(provider || 'unknown').toLowerCase(),
      metadata: { reason: 'half_open_failure', failureCount: st.failureCount, openWindowMs: OPEN_WINDOW_MS },
    });
  }
}

export function getProviderCircuitState(provider) {
  const st = getState(provider);
  if (st.state === 'OPEN' && now() - st.lastFailure >= OPEN_WINDOW_MS) {
    st.state = 'HALF_OPEN';
  }
  return {
    state: st.state,
    failureCount: st.failureCount,
    lastFailure: st.lastFailure,
  };
}

export function updateProviderMetrics(provider, latency, success) {
  const key = String(provider || 'unknown').toLowerCase();
  const current = providerMetrics.get(key) || {
    latencyAvg: null,
    samples: 0,
    lastCheck: null,
    lastSuccess: false,
  };
  const safeLatency = Number.isFinite(Number(latency)) ? Number(latency) : null;
  const nextSamples = Math.min(1000, current.samples + 1);
  const prevAvg = current.latencyAvg == null ? safeLatency : current.latencyAvg;
  const nextAvg =
    safeLatency == null
      ? current.latencyAvg
      : current.samples <= 0 || prevAvg == null
        ? safeLatency
        : ((prevAvg * current.samples) + safeLatency) / nextSamples;

  providerMetrics.set(key, {
    latencyAvg: nextAvg,
    samples: nextSamples,
    lastCheck: new Date().toISOString(),
    lastSuccess: Boolean(success),
  });
}

function normalizeHealthStatus(statusMap) {
  const values = Object.values(statusMap || {}).map((s) => String(s || '').toUpperCase());
  if (values.includes('WORKING')) return 'OK';
  if (values.some((v) => v && v !== 'OFFLINE')) return 'DEGRADED';
  return 'DOWN';
}

export async function getMessagingHealth() {
  const providerManager = await import('./providerManager.js');
  const status = await providerManager.getProviderStatus();
  const runtime = providerManager.getProviderRuntimeMetrics();
  const messages = getMessageStats();
  const providers = {};
  for (const [name, providerStatus] of Object.entries(status)) {
    const metrics = providerMetrics.get(name) || null;
    providers[name] = {
      status: providerStatus,
      latency: metrics?.latencyAvg ?? null,
      lastCheck: metrics?.lastCheck ?? null,
    };
  }
  const utilizationPercent =
    runtime.maxConcurrent > 0 ? Number(((runtime.activeRequests / runtime.maxConcurrent) * 100).toFixed(2)) : 0;
  const health = {
    status: normalizeHealthStatus(status),
    providers,
    queue: {
      activeRequests: runtime.activeRequests,
      maxConcurrent: runtime.maxConcurrent,
      utilizationPercent,
    },
    messages,
    timestamp: new Date().toISOString(),
  };
  console.log(JSON.stringify({ event: 'HEALTH_CHECK', ...health }));
  return health;
}
