import { getChannelStateCounts } from '../repositories/channel.repository.js';
import { getTrackedCounts } from './channelStateTracker.js';
import { getChannelConnectionQueue } from '../queues/channelConnection.queue.js';
import { getProviderCircuitState } from './providerHealth.js';
import { log } from '../utils/logger.js';
import { getChannelStateCounts as getRedisChannelStateCounts } from './redisChannelStateTracker.js';

export async function getSystemMetrics(tenantId = null) {
  const [dbCounts, queueCounts] = await Promise.all([
    getChannelStateCounts(tenantId),
    getChannelConnectionQueue().getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'),
  ]);

  let channels = null;
  try {
    channels = await getRedisChannelStateCounts(tenantId);
  } catch (err) {
    log.warn({
      event: 'REDIS_TRACKER_FALLBACK',
      context: 'service',
      tenantId,
      metadata: { reason: err?.message || 'redis_unavailable' },
    });
    const tracked = getTrackedCounts(tenantId);
    channels = tracked.total > 0 ? tracked : dbCounts;
  }
  const queue = {
    waiting: Number(queueCounts?.waiting || 0) + Number(queueCounts?.delayed || 0),
    active: Number(queueCounts?.active || 0),
    failed: Number(queueCounts?.failed || 0),
    completed: Number(queueCounts?.completed || 0),
    delayed: Number(queueCounts?.delayed || 0),
  };

  const providers = {
    waha: getProviderCircuitState('waha').state,
    evolution: getProviderCircuitState('evolution').state,
  };

  const metrics = {
    channels: {
      total: Number(channels.total || 0),
      connected: Number(channels.connected || 0),
      error: Number(channels.error || 0),
      waiting: Number(channels.waiting || 0),
      connecting: Number(channels.connecting || 0),
    },
    queue: {
      waiting: queue.waiting,
      active: queue.active,
      failed: queue.failed,
      completed: queue.completed,
    },
    providers,
    timestamp: new Date().toISOString(),
  };

  evaluateSystemAlerts(metrics, tenantId);
  return metrics;
}

function evaluateSystemAlerts(metrics, tenantId) {
  const total = Number(metrics?.channels?.total || 0);
  const errors = Number(metrics?.channels?.error || 0);
  const errorRate = total > 0 ? errors / total : 0;
  if (errorRate > 0.1) {
    log.warn({
      event: 'SYSTEM_ALERT',
      context: 'service',
      tenantId,
      metadata: { type: 'channel_error_rate', errorRate, threshold: 0.1 },
    });
  }
  if (Number(metrics?.queue?.waiting || 0) > 100) {
    log.warn({
      event: 'SYSTEM_ALERT',
      context: 'service',
      tenantId,
      metadata: { type: 'queue_waiting_high', waiting: metrics.queue.waiting, threshold: 100 },
    });
  }
  if (metrics?.providers?.waha === 'OPEN' || metrics?.providers?.evolution === 'OPEN') {
    log.warn({
      event: 'SYSTEM_ALERT',
      context: 'service',
      tenantId,
      metadata: { type: 'provider_circuit_open', providers: metrics.providers },
    });
  }
}
