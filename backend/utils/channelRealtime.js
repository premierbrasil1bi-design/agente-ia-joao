function getIo() {
  return globalThis.io || null;
}

const ROOM_PREFIX = 'tenant:';
const CHANNEL_ROOM_PREFIX = 'channel:';
const throttleMap = new Map();
const METRIC_KEY_EVENTS = 'socket:metrics:events';
const METRIC_KEY_ERRORS = 'socket:metrics:errors';

function getRedis() {
  try {
    return globalThis.redisMain || null;
  } catch {
    return null;
  }
}

function tenantRoom(tenantId) {
  return `${ROOM_PREFIX}${String(tenantId)}`;
}

function channelRoom(channelId) {
  return `${CHANNEL_ROOM_PREFIX}${String(channelId)}`;
}

function shouldEmitThrottled(key, minIntervalMs) {
  const now = Date.now();
  const prev = throttleMap.get(key) || 0;
  if (now - prev < minIntervalMs) return false;
  throttleMap.set(key, now);
  return true;
}

async function shouldEmitDistributed(key, minIntervalMs) {
  const redis = getRedis();
  if (!redis) return true;
  try {
    const ok = await redis.set(`socket:throttle:${key}`, '1', 'PX', minIntervalMs, 'NX');
    return ok === 'OK';
  } catch {
    return true;
  }
}

async function observeEvent(payload, type = 'updated') {
  const redis = getRedis();
  const tenantId = String(payload?.tenantId || 'unknown');
  const provider = String(payload?.provider || 'unknown');
  const date = new Date().toISOString().slice(0, 10);
  console.log('[SOCKET][EVENT]', { type, tenantId, provider, channelId: payload?.channelId ?? null });
  if (!redis) return;
  try {
    await redis.hincrby(METRIC_KEY_EVENTS, `total:${date}`, 1);
    await redis.hincrby(METRIC_KEY_EVENTS, `tenant:${tenantId}:${date}`, 1);
    await redis.hincrby(METRIC_KEY_EVENTS, `provider:${provider}:${date}`, 1);
    await redis.expire(METRIC_KEY_EVENTS, 60 * 60 * 24 * 14);
  } catch {
    /* ignore observability failures */
  }
}

async function observeError(payload) {
  const redis = getRedis();
  const tenantId = String(payload?.tenantId || 'unknown');
  const provider = String(payload?.provider || 'unknown');
  const date = new Date().toISOString().slice(0, 10);
  console.warn('[SOCKET][ERROR_EVENT]', {
    tenantId,
    provider,
    channelId: payload?.channelId ?? null,
    code: payload?.code ?? null,
  });
  if (!redis) return;
  try {
    await redis.hincrby(METRIC_KEY_ERRORS, `total:${date}`, 1);
    await redis.hincrby(METRIC_KEY_ERRORS, `tenant:${tenantId}:${date}`, 1);
    await redis.hincrby(METRIC_KEY_ERRORS, `provider:${provider}:${date}`, 1);
    await redis.expire(METRIC_KEY_ERRORS, 60 * 60 * 24 * 14);
  } catch {
    /* ignore observability failures */
  }
}

export function emitChannelEvent(event, payload) {
  const io = getIo();
  if (!io) return;
  const tenantId = payload?.tenantId;
  if (!tenantId) return;
  io.to(tenantRoom(tenantId)).emit(event, payload);
  if (payload?.channelId) {
    io.to(channelRoom(payload.channelId)).emit(event, payload);
  }
}

export function emitChannelSocketEvent(event, payload) {
  emitChannelEvent(event, payload);
}

export function emitMessageEvent(event, payload) {
  emitChannelEvent(event, payload);
}

export function emitChannelUpdated(channel, extra = {}) {
  if (!channel?.id) return;
  const payload = {
    channelId: channel.id,
    tenantId: channel.tenant_id ?? null,
    provider: channel.provider ?? null,
    connection_status: channel.connection_status ?? null,
    last_error: channel.last_error ?? null,
    updated_at: channel.updated_at ?? new Date().toISOString(),
    ...extra,
  };
  const key = `updated:${payload.tenantId}:${payload.channelId}:${payload.connection_status}:${payload.last_error || ''}`;
  if (!shouldEmitThrottled(key, 300)) return;
  void (async () => {
    if (!(await shouldEmitDistributed(key, 300))) return;
    emitChannelEvent('channels:updated', payload);
    await observeEvent(payload, 'updated');
  })();
}

export function emitChannelError(channel, error, context = {}) {
  const payload = {
    channelId: channel?.id ?? null,
    tenantId: channel?.tenant_id ?? null,
    provider: channel?.provider ?? null,
    message: error?.message || String(error || 'unknown_error'),
    code: error?.code || error?.response?.status || null,
    context,
    at: new Date().toISOString(),
  };
  const key = `error:${payload.tenantId}:${payload.channelId}:${payload.code || ''}:${payload.message}`;
  if (!shouldEmitThrottled(key, 2000)) return;
  void (async () => {
    if (!(await shouldEmitDistributed(key, 2000))) return;
    emitChannelEvent('channels:error', payload);
    await observeError(payload);
  })();
}

export function deriveHealth(status, latencyMs, hasError) {
  const s = String(status || '').toLowerCase();
  if (hasError || s === 'error' || s === 'disconnected') return 'offline';
  if (s === 'connecting') return 'instavel';
  if (latencyMs != null && latencyMs > 2500) return 'instavel';
  if (s === 'connected') return 'online';
  return 'offline';
}
