import { log } from '../utils/logger.js';
const cache = new Map();
const inFlight = new Map();
const DEFAULT_TTL_MS = 5000;

function keyOf(tenantId, channelId) {
  return `${String(tenantId)}:${String(channelId)}`;
}

export function getCachedState(tenantId, channelId, ttlMs = DEFAULT_TTL_MS) {
  const key = keyOf(tenantId, channelId);
  const item = cache.get(key);
  if (!item) {
    log.info({ event: 'CACHE_MISS', context: 'service', tenantId, channelId, metadata: { reason: 'empty' } });
    return null;
  }
  if (Date.now() - item.updatedAt > ttlMs) {
    log.info({ event: 'CACHE_MISS', context: 'service', tenantId, channelId, metadata: { reason: 'ttl_expired' } });
    return null;
  }
  log.info({ event: 'CACHE_HIT', context: 'service', tenantId, channelId });
  return item.state;
}

export function setCachedState(tenantId, channelId, state) {
  const key = keyOf(tenantId, channelId);
  cache.set(key, {
    state,
    updatedAt: Date.now(),
  });
}

export function getLastState(tenantId, channelId) {
  const item = cache.get(keyOf(tenantId, channelId));
  return item?.state || null;
}

export function getInFlight(tenantId, channelId) {
  const key = keyOf(tenantId, channelId);
  const promise = inFlight.get(key) || null;
  if (promise) {
    log.info({ event: 'CACHE_INFLIGHT_REUSED', context: 'service', tenantId, channelId });
  }
  return promise;
}

export function setInFlight(tenantId, channelId, promise) {
  const key = keyOf(tenantId, channelId);
  inFlight.set(key, promise);
  promise.finally(() => {
    if (inFlight.get(key) === promise) inFlight.delete(key);
  });
  return promise;
}
