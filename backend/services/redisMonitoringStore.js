import { getRedisConnection } from '../queues/evolution.queue.js';
import { SNAPSHOT_TTL_SECONDS } from '../config/monitoring.config.js';
import { log } from '../utils/logger.js';

const MAX_SNAPSHOTS = 60;
const KEY_PREFIX = 'monitoring:snapshots:';

function keyOf(tenantId) {
  return `${KEY_PREFIX}${String(tenantId).trim()}`;
}

function clampLimit(limit = 30) {
  const parsed = Number(limit);
  if (!Number.isFinite(parsed)) return 30;
  return Math.min(Math.max(1, Math.trunc(parsed)), MAX_SNAPSHOTS);
}

async function touchSnapshotTtl(redis, key) {
  if (SNAPSHOT_TTL_SECONDS > 0) {
    await redis.expire(key, SNAPSHOT_TTL_SECONDS);
  }
}

function snapshotsEqual(a, b) {
  if (!a || !b) return false;
  return (
    a.timestamp === b.timestamp &&
    a.channels?.connected === b.channels?.connected &&
    a.channels?.error === b.channels?.error &&
    a.queue?.waiting === b.queue?.waiting
  );
}

export async function addSnapshot(tenantId, snapshot) {
  const t = String(tenantId || '').trim();
  if (!t || !snapshot?.timestamp) return false;
  const key = keyOf(t);
  const redis = getRedisConnection();

  const headRaw = await redis.lindex(key, -1);
  if (headRaw) {
    const head = JSON.parse(headRaw);
    if (head?.timestamp === snapshot.timestamp) {
      if (snapshotsEqual(head, snapshot)) {
        await touchSnapshotTtl(redis, key);
        return false;
      }
      await redis.lset(key, -1, JSON.stringify(snapshot));
      await touchSnapshotTtl(redis, key);
      const snapshotCount = await redis.llen(key);
      log.info({
        event: 'REDIS_SNAPSHOT_STORED',
        context: 'service',
        tenantId: t,
        metadata: { key, mode: 'replace_last' },
      });
      log.info({
        event: 'REDIS_SNAPSHOT_SIZE',
        context: 'service',
        tenantId: t,
        metadata: { key, snapshotCount },
      });
      return true;
    }
  }

  await redis.rpush(key, JSON.stringify(snapshot));
  await redis.ltrim(key, -MAX_SNAPSHOTS, -1);
  await touchSnapshotTtl(redis, key);
  const snapshotCount = await redis.llen(key);
  log.info({
    event: 'REDIS_SNAPSHOT_STORED',
    context: 'service',
    tenantId: t,
    metadata: { key, mode: 'append', bufferSize: snapshotCount },
  });
  log.info({
    event: 'REDIS_SNAPSHOT_SIZE',
    context: 'service',
    tenantId: t,
    metadata: { key, snapshotCount },
  });
  return true;
}

export async function getSnapshots(tenantId, limit = 30) {
  const t = String(tenantId || '').trim();
  if (!t) return [];
  const n = clampLimit(limit);
  const key = keyOf(t);
  const redis = getRedisConnection();
  const items = await redis.lrange(key, -n, -1);
  const snapshots = items.map((raw) => JSON.parse(raw));
  const snapshotCount = await redis.llen(key);
  log.info({
    event: 'REDIS_SNAPSHOT_READ',
    context: 'service',
    tenantId: t,
    metadata: { key, limit: n, count: snapshots.length },
  });
  log.info({
    event: 'REDIS_SNAPSHOT_SIZE',
    context: 'service',
    tenantId: t,
    metadata: { key, snapshotCount },
  });
  return snapshots;
}

export async function getLatestSnapshot(tenantId) {
  const t = String(tenantId || '').trim();
  if (!t) return null;
  const key = keyOf(t);
  const redis = getRedisConnection();
  const raw = await redis.lindex(key, -1);
  const latest = raw ? JSON.parse(raw) : null;
  const snapshotCount = await redis.llen(key);
  log.info({
    event: 'REDIS_SNAPSHOT_READ',
    context: 'service',
    tenantId: t,
    metadata: { key, limit: 1, count: latest ? 1 : 0 },
  });
  log.info({
    event: 'REDIS_SNAPSHOT_SIZE',
    context: 'service',
    tenantId: t,
    metadata: { key, snapshotCount },
  });
  return latest;
}
