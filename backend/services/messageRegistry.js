import { incrementCleanup, incrementEviction } from './telemetry.service.js';
const messageStore = new Map();
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_MESSAGES = 10000;

function nowMs() {
  return Date.now();
}

function keyOf(messageId) {
  return `message:${String(messageId || '').trim()}`;
}

function isExpired(value) {
  if (!value?.expiresAt) return false;
  return Date.parse(value.expiresAt) <= nowMs();
}

function cleanupExpiredKey(storeKey) {
  const current = messageStore.get(storeKey);
  if (current && isExpired(current)) {
    messageStore.delete(storeKey);
    return true;
  }
  return false;
}

function clone(value) {
  return value ? JSON.parse(JSON.stringify(value)) : value;
}

function toMillis(value) {
  if (!value) return null;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : null;
}

function cleanupExpiredMessages() {
  const now = Date.now();
  let removed = 0;
  for (const [key, value] of messageStore.entries()) {
    const expiresMs = toMillis(value?.expiresAt);
    if (expiresMs != null && expiresMs < now) {
      messageStore.delete(key);
      removed += 1;
    }
  }
  if (removed > 0) {
    incrementCleanup(removed);
    console.log(JSON.stringify({
      event: 'REGISTRY_CLEANUP',
      removed,
      timestamp: new Date().toISOString(),
    }));
  }
}

export const storage = {
  async get(key) {
    cleanupExpiredKey(key);
    return clone(messageStore.get(key) ?? null);
  },
  async set(key, value) {
    messageStore.set(key, clone(value));
    return true;
  },
  async exists(key) {
    cleanupExpiredKey(key);
    return messageStore.has(key);
  },
  async delete(key) {
    return messageStore.delete(key);
  },
};

export function registerMessage(messageId, payload, opts = {}) {
  if (!messageId) return null;
  const storeKey = keyOf(messageId);
  cleanupExpiredKey(storeKey);
  if (messageStore.has(storeKey)) return { exists: true };
  if (messageStore.size >= MAX_MESSAGES) {
    const oldestKey = messageStore.keys().next().value;
    if (oldestKey) {
      messageStore.delete(oldestKey);
      incrementEviction();
      console.log(JSON.stringify({
        event: 'REGISTRY_LIMIT_EVICTION',
        evictedKey: oldestKey,
        maxMessages: MAX_MESSAGES,
        timestamp: new Date().toISOString(),
      }));
    }
  }

  const ttlMs = Number.isFinite(Number(opts?.ttlMs)) ? Number(opts.ttlMs) : DEFAULT_TTL_MS;
  const nowIso = new Date().toISOString();
  const entry = {
    messageId: String(messageId),
    status: 'PENDING',
    provider: null,
    payload,
    createdAt: nowIso,
    updatedAt: nowIso,
    sentAt: null,
    failedAt: null,
    expiresAt: new Date(nowMs() + Math.max(60_000, ttlMs)).toISOString(),
    attempts: [],
  };
  messageStore.set(storeKey, entry);
  return { exists: false };
}

export function markAsSent(messageId, provider) {
  const storeKey = keyOf(messageId);
  cleanupExpiredKey(storeKey);
  if (!messageStore.has(storeKey)) return;
  const msg = messageStore.get(storeKey);
  const nowIso = new Date().toISOString();
  msg.status = 'SENT';
  msg.provider = provider;
  msg.sentAt = nowIso;
  msg.updatedAt = nowIso;
}

export function markAsFailed(messageId, error) {
  const storeKey = keyOf(messageId);
  cleanupExpiredKey(storeKey);
  if (!messageStore.has(storeKey)) return;
  const msg = messageStore.get(storeKey);
  const nowIso = new Date().toISOString();
  msg.status = 'FAILED';
  msg.error = error;
  msg.failedAt = nowIso;
  msg.updatedAt = nowIso;
}

export function addAttempt(messageId, attempt) {
  const storeKey = keyOf(messageId);
  cleanupExpiredKey(storeKey);
  if (!messageStore.has(storeKey)) return;
  const msg = messageStore.get(storeKey);
  if (!Array.isArray(msg.attempts)) msg.attempts = [];
  msg.attempts.push({
    type: String(attempt?.type || attempt?.status || 'ATTEMPT').toUpperCase(),
    provider: attempt?.provider || null,
    timestamp: attempt?.timestamp || new Date().toISOString(),
    latency: attempt?.latency ?? null,
    error: attempt?.error ?? null,
  });
  msg.updatedAt = new Date().toISOString();
}

export function getMessage(messageId) {
  const storeKey = keyOf(messageId);
  cleanupExpiredKey(storeKey);
  return clone(messageStore.get(storeKey) ?? null);
}

export function listMessages({ page = 1, limit = 20 } = {}) {
  for (const key of messageStore.keys()) cleanupExpiredKey(key);
  const p = Math.max(1, Number(page) || 1);
  const l = Math.max(1, Math.min(100, Number(limit) || 20));
  const all = Array.from(messageStore.values())
    .sort((a, b) => Date.parse(b?.updatedAt || 0) - Date.parse(a?.updatedAt || 0));
  const total = all.length;
  const start = (p - 1) * l;
  const data = all.slice(start, start + l).map((m) => clone(m));
  return { page: p, limit: l, total, data };
}

export function getMessageStats() {
  for (const key of messageStore.keys()) cleanupExpiredKey(key);
  let pending = 0;
  let sent = 0;
  let failed = 0;
  let expiredEstimate = 0;
  for (const msg of messageStore.values()) {
    if (isExpired(msg)) expiredEstimate += 1;
    if (msg.status === 'PENDING') pending += 1;
    else if (msg.status === 'SENT') sent += 1;
    else if (msg.status === 'FAILED') failed += 1;
  }
  return {
    total: pending + sent + failed,
    pending,
    sent,
    failed,
    expiredEstimate,
    memoryUsage: process.memoryUsage().heapUsed,
  };
}

export function getRecentMessages(limit = 10) {
  return listMessages({ page: 1, limit }).data;
}

export function getRegistryDebugInfo() {
  for (const key of messageStore.keys()) cleanupExpiredKey(key);
  const now = Date.now();
  let oldestMessageAge = 0;
  for (const msg of messageStore.values()) {
    const createdAtMs = toMillis(msg?.createdAt);
    if (createdAtMs == null) continue;
    const age = Math.max(0, now - createdAtMs);
    if (age > oldestMessageAge) oldestMessageAge = age;
  }
  return {
    totalMessages: messageStore.size,
    maxMessages: MAX_MESSAGES,
    memoryUsageMB: Number((process.memoryUsage().heapUsed / (1024 * 1024)).toFixed(2)),
    oldestMessageAge,
  };
}

const cleanupInterval = setInterval(() => {
  try {
    cleanupExpiredMessages();
  } catch (err) {
    console.error(JSON.stringify({
      event: 'REGISTRY_CLEANUP_ERROR',
      error: err?.message || String(err),
      timestamp: new Date().toISOString(),
    }));
  }
}, 60_000);

if (typeof cleanupInterval.unref === 'function') {
  cleanupInterval.unref();
}
