import { getRedisConnection } from '../queues/evolution.queue.js';
import {
  CHANNEL_STATE_TTL_SECONDS,
  MAX_CHANNELS_PER_TENANT,
} from '../config/monitoring.config.js';
import { log } from '../utils/logger.js';

const KEY_PREFIX = 'monitoring:channel-state:';
const TENANT_INDEX_PREFIX = 'monitoring:tenant-channels:';

function keyOf(tenantId, channelId) {
  return `${KEY_PREFIX}${String(tenantId).trim()}:${String(channelId).trim()}`;
}

function indexKeyOf(tenantId) {
  return `${TENANT_INDEX_PREFIX}${String(tenantId).trim()}`;
}

const MGET_CHUNK = 200;

async function aggregateFromScan(redis, tenantId) {
  const t = String(tenantId).trim();
  const prefix = `${KEY_PREFIX}${t}:`;
  const out = { total: 0, connected: 0, error: 0, waiting: 0, connecting: 0 };
  let cursor = '0';
  do {
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200);
    cursor = nextCursor;
    if (!keys.length) continue;
    for (let i = 0; i < keys.length; i += MGET_CHUNK) {
      const slice = keys.slice(i, i + MGET_CHUNK);
      const values = await redis.mget(slice);
      for (const raw of values) {
        if (!raw) continue;
        out.total += 1;
        let status = 'connecting';
        try {
          status = String(JSON.parse(raw)?.status || 'connecting').toLowerCase();
        } catch {
          status = 'connecting';
        }
        if (status === 'connected') out.connected += 1;
        else if (status === 'error') out.error += 1;
        else if (status === 'waiting' || status === 'ready') out.waiting += 1;
        else out.connecting += 1;
      }
    }
  } while (cursor !== '0');
  return out;
}

export async function trackChannelState({ tenantId, channelId, status }) {
  const t = String(tenantId || '').trim();
  const c = String(channelId || '').trim();
  if (!t || !c) return;
  const key = keyOf(t, c);
  const indexKey = indexKeyOf(t);
  const redis = getRedisConnection();
  const payload = {
    status: String(status || 'connecting').toLowerCase(),
    updatedAt: Date.now(),
  };

  const pipe = redis.pipeline();
  pipe.set(key, JSON.stringify(payload), 'EX', CHANNEL_STATE_TTL_SECONDS);
  pipe.sadd(indexKey, c);
  pipe.expire(indexKey, CHANNEL_STATE_TTL_SECONDS);
  await pipe.exec();

  if (MAX_CHANNELS_PER_TENANT > 0) {
    const card = await redis.scard(indexKey);
    if (card > MAX_CHANNELS_PER_TENANT) {
      log.warn({
        event: 'TENANT_CHANNEL_LIMIT_EXCEEDED',
        context: 'service',
        tenantId: t,
        metadata: { indexKey, channelCount: card, limit: MAX_CHANNELS_PER_TENANT },
      });
    }
  }

  log.info({
    event: 'REDIS_TRACKER_UPDATED',
    context: 'service',
    tenantId: t,
    channelId: c,
    metadata: { key, status: payload.status },
  });
}

export async function getChannelStateCounts(tenantId) {
  const t = String(tenantId || '').trim();
  if (!t) return { total: 0, connected: 0, error: 0, waiting: 0, connecting: 0 };
  const redis = getRedisConnection();
  const indexKey = indexKeyOf(t);
  const memberIds = await redis.smembers(indexKey);

  if (memberIds.length === 0) {
    const out = await aggregateFromScan(redis, t);
    log.info({
      event: 'REDIS_TRACKER_COUNTS_READ',
      context: 'service',
      tenantId: t,
      metadata: { mode: 'scan_fallback', total: out.total },
    });
    log.info({
      event: 'REDIS_TRACKER_SIZE',
      context: 'service',
      tenantId: t,
      metadata: { totalChannelsTracked: out.total },
    });
    return out;
  }

  const keys = memberIds.map((id) => keyOf(t, id));
  const out = { total: 0, connected: 0, error: 0, waiting: 0, connecting: 0 };
  const stale = [];

  for (let i = 0; i < keys.length; i += MGET_CHUNK) {
    const sliceKeys = keys.slice(i, i + MGET_CHUNK);
    const sliceIds = memberIds.slice(i, i + MGET_CHUNK);
    const values = await redis.mget(sliceKeys);
    for (let j = 0; j < values.length; j += 1) {
      const raw = values[j];
      const id = sliceIds[j];
      if (!raw) {
        stale.push(id);
        continue;
      }
      out.total += 1;
      let st = 'connecting';
      try {
        st = String(JSON.parse(raw)?.status || 'connecting').toLowerCase();
      } catch {
        st = 'connecting';
      }
      if (st === 'connected') out.connected += 1;
      else if (st === 'error') out.error += 1;
      else if (st === 'waiting' || st === 'ready') out.waiting += 1;
      else out.connecting += 1;
    }
  }

  if (stale.length > 0) {
    for (let i = 0; i < stale.length; i += 500) {
      await redis.srem(indexKey, ...stale.slice(i, i + 500));
    }
  }

  log.info({
    event: 'REDIS_TRACKER_COUNTS_READ',
    context: 'service',
    tenantId: t,
    metadata: { mode: 'index', total: out.total, pruned: stale.length },
  });
  log.info({
    event: 'REDIS_TRACKER_SIZE',
    context: 'service',
    tenantId: t,
    metadata: { totalChannelsTracked: out.total },
  });
  return out;
}
