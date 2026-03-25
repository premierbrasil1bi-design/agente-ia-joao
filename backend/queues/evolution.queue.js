import { Queue, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';

export const EVOLUTION_JOB = {
  CREATE: 'CREATE',
  CONNECT: 'CONNECT',
  QRCODE: 'QRCODE',
  DELETE: 'DELETE',
  STATUS: 'STATUS',
  DISCONNECT: 'DISCONNECT',
  SEND_TEXT: 'SEND_TEXT',
  HEALTH: 'HEALTH',
};

const QUEUE_NAME = 'evolution-api';

/** @type {IORedis | null} */
let redis = null;
/** @type {Queue | null} */
let evolutionQueue = null;
/** @type {QueueEvents | null} */
let queueEvents = null;

export function getRedisUrl() {
  const raw = process.env.REDIS_URL;
  if (raw != null && String(raw).trim() !== '') {
    return String(raw).trim().replace('saas_redis', '127.0.0.1');
  }
  return 'redis://127.0.0.1:6379';
}

export function getRedisConnection() {
  if (!redis) {
    redis = new IORedis(getRedisUrl(), {
      maxRetriesPerRequest: null,
    });
    redis.on('error', (err) => {
      console.error('Redis error:', err?.message || err);
    });
  }
  return redis;
}

export function getEvolutionQueue() {
  if (!evolutionQueue) {
    evolutionQueue = new Queue(QUEUE_NAME, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { age: 3600, count: 2000 },
        removeOnFail: { age: 86400, count: 500 },
      },
    });
  }
  return evolutionQueue;
}

export function getEvolutionQueueEvents() {
  if (!queueEvents) {
    queueEvents = new QueueEvents(QUEUE_NAME, {
      connection: getRedisConnection(),
    });
  }
  return queueEvents;
}

export async function initEvolutionQueueInfra() {
  getRedisConnection();
  getEvolutionQueue();
  const ev = getEvolutionQueueEvents();
  try {
    await ev.waitUntilReady();
  } catch (err) {
    console.error('[redis] Falha ao inicializar BullMQ/QueueEvents (continuando sem derrubar):', err?.message || err);
  }
}

export async function closeEvolutionQueueInfra() {
  await Promise.all([
    queueEvents?.close(),
    evolutionQueue?.close(),
    redis?.quit(),
  ]);
  queueEvents = null;
  evolutionQueue = null;
  redis = null;
}

/**
 * Serializa erro axios para atravessar a fila (waitUntilFinished reconstrói no API).
 */
export function serializeAxiosErrorForJob(err) {
  if (err?.response) {
    let data = err.response.data;
    if (typeof data === 'object' && data !== null) {
      try {
        const s = JSON.stringify(data);
        if (s.length > 4000) {
          data = { _truncated: true, preview: s.slice(0, 4000) };
        }
      } catch {
        data = String(data);
      }
    }
    return new Error(
      JSON.stringify({
        type: 'EVOLUTION_AXIOS',
        status: err.response.status,
        data,
        message: err.message,
        code: err.code,
      })
    );
  }
  return new Error(
    JSON.stringify({
      type: 'EVOLUTION_ERR',
      message: err.message,
      code: err.code,
    })
  );
}

export function unwrapEvolutionJobError(err) {
  const raw = err?.failedReason ?? err?.message ?? String(err);
  if (typeof raw !== 'string') return err;
  try {
    const j = JSON.parse(raw);
    if (j.type === 'EVOLUTION_AXIOS') {
      const ne = new Error(j.message || 'Evolution HTTP error');
      ne.response = { status: j.status, data: j.data };
      ne.isAxiosError = true;
      ne.code = j.code;
      return ne;
    }
    if (j.type === 'EVOLUTION_ERR') {
      const ne = new Error(j.message || 'Evolution error');
      ne.code = j.code;
      return ne;
    }
  } catch {
    /* ignore */
  }
  return err;
}

/**
 * @param {string} jobName
 * @param {object} data
 * @param {{ timeoutMs?: number, priority?: number }} [options]
 */
export async function addEvolutionJobAndWait(jobName, data, options = {}) {
  const { timeoutMs = 120000, priority } = options;
  const q = getEvolutionQueue();
  const events = getEvolutionQueueEvents();
  await events.waitUntilReady();

  const job = await q.add(jobName, data, {
    ...(priority != null ? { priority } : {}),
  });

  try {
    return await job.waitUntilFinished(events, timeoutMs);
  } catch (e) {
    throw unwrapEvolutionJobError(e);
  }
}
