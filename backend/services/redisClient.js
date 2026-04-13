import Redis from 'ioredis';

let redis = null;

export function getRedis() {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: 1,
      enableReadyCheck: false,
    });

    redis.on('error', (err) => {
      console.error('REDIS_ERROR', err?.message || String(err));
    });
  }

  return redis;
}

export function isRedisConnected() {
  if (!redis) return false;
  return redis.status === 'ready' || redis.status === 'connect';
}
