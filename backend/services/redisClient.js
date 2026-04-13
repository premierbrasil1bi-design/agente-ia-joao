import Redis from 'ioredis';

/** @type {Redis | null} */
let redisSingleton = null;

const redisRuntime = {
  connected: false,
  lastError: null,
  lastEventAt: null,
};

const ERROR_LOG_MS = 30_000;
let lastThrottledErrorKey = '';
let lastThrottledErrorAt = 0;

const LIFECYCLE = Symbol('redisLifecycleAttached');

/**
 * @returns {{ url: string } | { host: string, port: number }}
 */
export function getRedisConfig() {
  const url = String(process.env.REDIS_URL || '').trim();
  if (url) {
    return { url };
  }
  const host = String(process.env.REDIS_HOST || 'saas_redis').trim() || 'saas_redis';
  const port = Number(process.env.REDIS_PORT || 6379);
  return {
    host,
    port: Number.isFinite(port) ? port : 6379,
  };
}

export function getRedisUrl() {
  const cfg = getRedisConfig();
  if (cfg.url) return cfg.url;
  return `redis://${cfg.host}:${cfg.port}`;
}

function buildClientOptions(role) {
  return {
    connectionName: String(role || 'default'),
    lazyConnect: false,
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
    connectTimeout: 5000,
    retryStrategy(times) {
      return Math.min(times * 200, 2000);
    },
  };
}

function redisStructuredLog(event, extra = {}) {
  console.log(JSON.stringify({
    event,
    timestamp: new Date().toISOString(),
    ...extra,
  }));
}

function errorFingerprint(err) {
  if (err?.errors && Array.isArray(err.errors)) {
    return err.errors.map((e) => e?.message || String(e)).join('|') || err?.message || String(err);
  }
  return err?.message || String(err);
}

function touchRuntime(partial) {
  Object.assign(redisRuntime, partial);
  redisRuntime.lastEventAt = new Date().toISOString();
}

function logRedisErrorThrottled(err, role, trackRuntime) {
  const msg = errorFingerprint(err);
  if (trackRuntime) {
    touchRuntime({ connected: false, lastError: msg });
  }
  const now = Date.now();
  if (msg === lastThrottledErrorKey && now - lastThrottledErrorAt < ERROR_LOG_MS) {
    return;
  }
  lastThrottledErrorKey = msg;
  lastThrottledErrorAt = now;
  redisStructuredLog('REDIS_ERROR', {
    role: role || 'default',
    error: msg,
  });
}

/**
 * @param {string} [role='default']
 * @returns {import('ioredis').default}
 */
export function createRedisClient(role = 'default') {
  const cfg = getRedisConfig();
  const opts = buildClientOptions(role);
  if (cfg.url) {
    return new Redis(cfg.url, opts);
  }
  return new Redis({
    host: cfg.host,
    port: cfg.port,
    ...opts,
  });
}

/**
 * @param {import('ioredis').default} client
 * @param {string} role
 * @param {{ trackRuntime?: boolean }} [opts]
 */
function attachRedisLifecycle(client, role, opts = {}) {
  const trackRuntime = Boolean(opts.trackRuntime);
  if (!client || client[LIFECYCLE]) return;
  client[LIFECYCLE] = true;

  client.on('connect', () => {
    redisStructuredLog('REDIS_CONNECT', { role });
  });

  client.on('ready', () => {
    if (trackRuntime) {
      touchRuntime({ connected: true, lastError: null });
    }
    redisStructuredLog('REDIS_READY', { role });
  });

  client.on('error', (err) => {
    logRedisErrorThrottled(err, role, trackRuntime);
  });

  client.on('close', () => {
    if (trackRuntime) {
      touchRuntime({ connected: false });
    }
    redisStructuredLog('REDIS_CLOSE', { role });
  });

  client.on('reconnecting', (delay) => {
    redisStructuredLog('REDIS_RECONNECTING', { role, delayMs: delay });
  });
}

/** Singleton para cache L2 e usos simples */
export function getRedis() {
  if (!redisSingleton) {
    redisSingleton = createRedisClient('cache-l2');
    attachRedisLifecycle(redisSingleton, 'cache-l2', { trackRuntime: true });
  }
  return redisSingleton;
}

/**
 * Par pub/sub dedicado ao adapter Socket.IO (não reutilizar singleton de cache).
 * @returns {{ pubClient: import('ioredis').default, subClient: import('ioredis').default }}
 */
export function createRedisPubSubPair() {
  const pubClient = createRedisClient('socket-io-pub');
  attachRedisLifecycle(pubClient, 'socket-io-pub', { trackRuntime: false });
  const subClient = pubClient.duplicate({ connectionName: 'socket-io-sub' });
  attachRedisLifecycle(subClient, 'socket-io-sub', { trackRuntime: false });
  return { pubClient, subClient };
}

/**
 * Conexão ioredis dedicada ao BullMQ da fila de sessão (não é o singleton de cache).
 * @returns {import('ioredis').default}
 */
export function createBullMQConnection() {
  const c = createRedisClient('bullmq-session-queue');
  attachRedisLifecycle(c, 'bullmq-session-queue', { trackRuntime: false });
  return c;
}

export function isRedisConnected() {
  if (!redisSingleton) return false;
  return redisSingleton.status === 'ready';
}

export function getRedisRuntime() {
  const client = getRedis();
  const ready = client.status === 'ready';
  return {
    connected: ready,
    lastError: ready ? null : redisRuntime.lastError,
    lastEventAt: redisRuntime.lastEventAt,
  };
}
