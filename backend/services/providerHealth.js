import { log } from '../utils/logger.js';
const providerState = new Map();

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
