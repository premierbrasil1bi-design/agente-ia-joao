import { getAdapter, getProviderFallbackOrder } from '../providers/sessionAdapters/index.js';
import * as channelRepository from '../repositories/channel.repository.js';
import {
  getSessionCache,
  getSessionCacheRuntime,
  invalidateSessionCache,
  setSessionCache,
} from './sessionCache.service.js';
import { emitEvent } from '../utils/socketEmitter.js';

const PROVIDER_TIMEOUT_MS = {
  waha: 12_000,
  evolution: 18_000,
  default: 15_000,
};
const sessionLocks = new Map();
const sessionStatusCache = new Map();
const providerFailures = new Map();
const SESSION_CACHE_TTL_MS = 5_000;
const PROVIDER_BLOCK_MS = 30_000;

function logEvent(event) {
  console.log(JSON.stringify({ ...event, timestamp: new Date().toISOString() }));
}

async function withSessionLock(sessionName, fn) {
  const key = String(sessionName || '').trim() || 'default';
  if (sessionLocks.has(key)) {
    return sessionLocks.get(key);
  }
  const promise = (async () => {
    try {
      return await fn();
    } finally {
      sessionLocks.delete(key);
    }
  })();
  sessionLocks.set(key, promise);
  return promise;
}

function getCachedStatus(sessionName) {
  const key = String(sessionName || '').trim() || 'default';
  const cached = sessionStatusCache.get(key);
  if (!cached) return null;
  if (Date.now() > cached.expiresAt) {
    sessionStatusCache.delete(key);
    return null;
  }
  return cached.value;
}

function setCachedStatus(sessionName, value) {
  const key = String(sessionName || '').trim() || 'default';
  sessionStatusCache.set(key, {
    value,
    expiresAt: Date.now() + SESSION_CACHE_TTL_MS,
  });
}

function invalidateSessionCacheL1(sessionName) {
  const key = String(sessionName || '').trim() || 'default';
  sessionStatusCache.delete(key);
}

async function invalidateAllCache(sessionName) {
  invalidateSessionCacheL1(sessionName);
  await invalidateSessionCache(sessionName);
}

function isProviderAvailable(provider) {
  const key = String(provider || '').toLowerCase().trim();
  const data = providerFailures.get(key);
  if (!data) return true;
  return Date.now() > Number(data.blockedUntil || 0);
}

function registerProviderFailure(provider) {
  const key = String(provider || '').toLowerCase().trim();
  const current = providerFailures.get(key) || { count: 0, blockedUntil: 0 };
  const count = Number(current.count || 0) + 1;
  const blockedUntil = count >= 3 ? Date.now() + PROVIDER_BLOCK_MS : 0;
  providerFailures.set(key, { count, blockedUntil });
}

function resetProviderFailures(provider) {
  const key = String(provider || '').toLowerCase().trim();
  providerFailures.delete(key);
}

function timeoutForProvider(provider) {
  return PROVIDER_TIMEOUT_MS[String(provider || '').toLowerCase()] || PROVIDER_TIMEOUT_MS.default;
}

async function withTimeout(promise, ms, context = {}) {
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error('Session operation timeout');
      err.code = 'SESSION_TIMEOUT';
      err.context = context;
      reject(err);
    }, ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function normalizeSessionError(provider, sessionName, err, stage = 'ensure') {
  return {
    ok: false,
    provider: String(provider || '').toLowerCase() || null,
    sessionName: String(sessionName || '').trim() || null,
    status: 'OFFLINE',
    stage,
    code: err?.code || 'SESSION_ORCHESTRATION_FAILED',
    message: 'Falha ao garantir sessão',
    details: {
      reason: err?.message || String(err),
    },
  };
}

async function updateChannelProvider(channelId, tenantId, provider) {
  try {
    if (!channelId || !tenantId || !provider) return;
    await channelRepository.updateConnection(channelId, tenantId, { provider });
  } catch (err) {
    console.error(JSON.stringify({
      event: 'PROVIDER_PERSIST_FAIL',
      channelId: channelId || null,
      tenantId: tenantId || null,
      provider: provider || null,
      error: err?.message || String(err),
      timestamp: new Date().toISOString(),
    }));
  }
}

async function ensureViaProvider(provider, sessionName) {
  const adapter = getAdapter(provider);
  let lastError = null;
  const tm = timeoutForProvider(provider);

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      let session = getCachedStatus(sessionName);
      if (!session) {
        session = await getSessionCache(sessionName);
      }
      if (!session) {
        session = await withTimeout(
          adapter.getSession(sessionName),
          tm,
          { provider, sessionName, op: 'getSession' },
        );
      }
      if (session) {
        setCachedStatus(sessionName, session);
        await setSessionCache(sessionName, session);
      }
      if (!session?.exists) {
        logEvent({ event: 'SESSION_CREATE', provider, sessionName, attempt });
        await withTimeout(adapter.createSession(sessionName), tm, { provider, sessionName, op: 'createSession' });
        await withTimeout(adapter.startSession(sessionName), tm, { provider, sessionName, op: 'startSession' });
        await invalidateAllCache(sessionName);
        session = await withTimeout(
          adapter.getSession(sessionName),
          tm,
          { provider, sessionName, op: 'getSession' },
        );
        setCachedStatus(sessionName, session);
        await setSessionCache(sessionName, session);
      } else if (session.status === 'OFFLINE' || session.status === 'FAILED') {
        logEvent({ event: 'SESSION_RECREATE', provider, sessionName, attempt });
        await invalidateAllCache(sessionName);
        await withTimeout(adapter.deleteSession(sessionName), tm, { provider, sessionName, op: 'deleteSession' }).catch(() => {});
        logEvent({ event: 'SESSION_DELETE', provider, sessionName, attempt });
        await withTimeout(adapter.createSession(sessionName), tm, { provider, sessionName, op: 'createSession' });
        await withTimeout(adapter.startSession(sessionName), tm, { provider, sessionName, op: 'startSession' });
        session = await withTimeout(
          adapter.getSession(sessionName),
          tm,
          { provider, sessionName, op: 'getSession' },
        );
        setCachedStatus(sessionName, session);
        await setSessionCache(sessionName, session);
      }

      if (session?.status === 'QR') {
        const qr = await withTimeout(adapter.getQRCode(sessionName), tm, { provider, sessionName, op: 'getQRCode' });
        logEvent({ event: 'SESSION_QR_READY', provider, sessionName, attempt, hasQr: Boolean(qr) });
        emitEvent('session:qr', {
          sessionName,
          provider,
          qr: qr || null,
        });
        return { providerUsed: provider, status: 'QR', qr: qr || null, connected: false };
      }

      if (session?.status === 'WORKING') {
        logEvent({ event: 'SESSION_CONNECTED', provider, sessionName, attempt });
        emitEvent('session:connected', {
          sessionName,
          provider,
        });
        resetProviderFailures(provider);
        return { providerUsed: provider, status: 'WORKING', qr: null, connected: true };
      }

      await withTimeout(adapter.startSession(sessionName), tm, { provider, sessionName, op: 'startSession' });
    } catch (err) {
      lastError = err;
      registerProviderFailure(provider);
      emitEvent('session:error', {
        sessionName,
        provider,
        error: 'Erro na sessão',
      });
      if (attempt < 3) {
        await invalidateAllCache(sessionName);
        await withTimeout(adapter.deleteSession(sessionName), tm, { provider, sessionName, op: 'deleteSession' }).catch(() => {});
      }
    }
  }

  throw normalizeSessionError(provider, sessionName, lastError || new Error(`Falha ao garantir sessão no provider ${provider}`));
}

export async function ensureSession({ provider, sessionName, channelId = null, tenantId = null }) {
  return withSessionLock(sessionName, async () => {
    const originalProvider = String(provider || '').toLowerCase().trim();
    const order = getProviderFallbackOrder(provider);
    let lastError = null;

    for (let i = 0; i < order.length; i += 1) {
      const currentProvider = order[i];
      if (!isProviderAvailable(currentProvider)) {
        lastError = normalizeSessionError(
          currentProvider,
          sessionName,
          new Error('Provider temporariamente indisponível (circuit breaker)'),
          'circuit_breaker',
        );
        continue;
      }
      try {
        if (i > 0) {
          logEvent({
            event: 'SESSION_PROVIDER_SWITCH',
            from: order[i - 1],
            to: currentProvider,
            sessionName,
          });
          emitEvent('session:failover', {
            sessionName,
            provider: currentProvider,
          });
          await invalidateAllCache(sessionName);
        }
        const result = await ensureViaProvider(currentProvider, sessionName);
        if (currentProvider !== originalProvider) {
          await invalidateAllCache(sessionName);
          await updateChannelProvider(channelId, tenantId, currentProvider);
        }
        return result;
      } catch (err) {
        lastError = err;
      }
    }

    throw normalizeSessionError(
      provider,
      sessionName,
      lastError || new Error('Falha ao garantir sessão em todos os providers'),
      'fallback',
    );
  });
}

export function getSessionOrchestratorRuntime() {
  return {
    providers: {
      failures: Array.from(providerFailures.entries()),
    },
    locks: {
      active: sessionLocks.size,
    },
    cache: {
      size: sessionStatusCache.size,
    },
    redis: getSessionCacheRuntime(),
  };
}

const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, value] of sessionStatusCache.entries()) {
    if (now > Number(value?.expiresAt || 0)) {
      sessionStatusCache.delete(key);
    }
  }
  for (const [provider, data] of providerFailures.entries()) {
    if (Number(data?.blockedUntil || 0) > 0 && now > Number(data.blockedUntil)) {
      providerFailures.delete(provider);
    }
  }
}, 60_000);

if (typeof cleanupInterval.unref === 'function') cleanupInterval.unref();
