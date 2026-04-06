/**
 * Lock distribuído opcional (Redis / ioredis). Fallback: sem lock multi-node (apenas lock local do processo).
 * Chave: prefixo fixo + chave composta (ex.: provider:tenant:session).
 */

import { randomUUID } from 'crypto';
import { getRedisConnection } from '../queues/evolution.queue.js';
import { createSessionOpError, SessionOpErrorCode } from './whatsapp/whatsappSessionErrors.js';

const LOCK_PREFIX = 'whatsapp:distlock:';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function distributedLockDisabled() {
  const v = String(process.env.WHATSAPP_DISTRIBUTED_LOCK_DISABLED || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function redisConfigured() {
  return Boolean(String(process.env.REDIS_HOST || '').trim());
}

/**
 * @returns {import('ioredis').default | null}
 */
function tryRedis() {
  if (distributedLockDisabled() || !redisConfigured()) return null;
  try {
    return getRedisConnection();
  } catch {
    return null;
  }
}

/**
 * @param {string} compositeKey — ex.: resultado de buildSessionLockKey
 * @param {string} token
 * @param {number} ttlMs
 */
export async function releaseDistributedLock(compositeKey, token, ttlMs = 0) {
  void ttlMs;
  const redis = tryRedis();
  if (!redis || !token) return;
  const redisKey = LOCK_PREFIX + compositeKey;
  const script =
    'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';
  try {
    await redis.eval(script, 1, redisKey, token);
  } catch {
    /* best-effort */
  }
}

/**
 * @param {string} compositeKey
 * @param {number} ttlMs
 * @returns {Promise<{ acquired: boolean, token: string|null, mode: 'redis'|'none', redisKey: string|null }>}
 */
export async function acquireDistributedLock(compositeKey, ttlMs) {
  const token = randomUUID();
  const redis = tryRedis();
  if (!redis) {
    return { acquired: true, token: null, mode: 'none', redisKey: null };
  }
  const redisKey = LOCK_PREFIX + compositeKey;
  try {
    const ok = await redis.set(redisKey, token, 'PX', ttlMs, 'NX');
    if (ok === 'OK') {
      return { acquired: true, token, mode: 'redis', redisKey };
    }
    return { acquired: false, token: null, mode: 'redis', redisKey };
  } catch {
    return { acquired: true, token: null, mode: 'none', redisKey: null };
  }
}

/**
 * @param {string} compositeKey
 * @param {number} ttlMs — TTL do lock no Redis (libera automaticamente se o processo morrer)
 * @param {() => Promise<T>} fn
 * @param {{ maxWaitMs?: number, pollMs?: number, correlationId?: string|null }} [opts]
 * @returns {Promise<T>}
 * @template T
 */
export async function withDistributedLock(compositeKey, ttlMs, fn, opts = {}) {
  const maxWaitMs =
    opts.maxWaitMs ??
    (parseInt(process.env.WHATSAPP_DISTRIBUTED_LOCK_MAX_WAIT_MS || '60000', 10) || 60000);
  const pollMs =
    opts.pollMs ??
    (parseInt(process.env.WHATSAPP_DISTRIBUTED_LOCK_POLL_MS || '250', 10) || 250);
  const correlationId = opts.correlationId ?? null;

  const redis = tryRedis();
  if (!redis) {
    return fn({ lockMode: 'local_only', correlationId });
  }

  const deadline = Date.now() + maxWaitMs;
  let token = null;
  let acquired = false;

  while (Date.now() < deadline) {
    const res = await acquireDistributedLock(compositeKey, ttlMs);
    if (res.mode === 'none') {
      return fn({ lockMode: 'local_only', correlationId, lockFallback: true });
    }
    if (res.acquired && res.token) {
      acquired = true;
      token = res.token;
      break;
    }
    await sleep(pollMs);
  }

  if (!acquired) {
    throw createSessionOpError(
      SessionOpErrorCode.DISTRIBUTED_LOCK_TIMEOUT,
      'Timeout aguardando lock distribuído de sessão WhatsApp',
      { correlationId, compositeKey, maxWaitMs },
    );
  }

  try {
    return await fn({ lockMode: 'redis', correlationId });
  } finally {
    await releaseDistributedLock(compositeKey, token, ttlMs);
  }
}
