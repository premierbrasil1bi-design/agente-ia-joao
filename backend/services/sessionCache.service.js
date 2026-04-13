import { getRedis, getRedisRuntime } from './redisClient.js';

const TTL = 5;

function keyOf(sessionName) {
  return `session:${String(sessionName || '').trim()}`;
}

export async function getSessionCache(sessionName) {
  try {
    const redis = getRedis();
    const data = await redis.get(keyOf(sessionName));
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

export async function setSessionCache(sessionName, value) {
  try {
    const redis = getRedis();
    await redis.set(
      keyOf(sessionName),
      JSON.stringify(value),
      'EX',
      TTL,
    );
  } catch {
    // noop: L2 cache best-effort
  }
}

export async function invalidateSessionCache(sessionName) {
  try {
    const redis = getRedis();
    await redis.del(keyOf(sessionName));
  } catch {
    // noop: L2 cache best-effort
  }
}

export function getSessionCacheRuntime() {
  return {
    ...getRedisRuntime(),
    ttlSeconds: TTL,
  };
}
