import { getProvider as getChannelProvider } from './channelProviders/providerFactory.js';
import { withTimeout } from '../utils/withTimeout.js';
import {
  canAttempt,
  markFailure,
  markSuccess,
  getProviderCircuitState,
} from './providerHealth.js';
import {
  getCachedState,
  setCachedState,
  getInFlight,
  setInFlight,
  getLastState,
} from './channelStateCache.js';
import { log } from '../utils/logger.js';
import { emitChannelSocketEvent } from '../utils/channelRealtime.js';
import { normalizeChannelStatus } from './channelProviders/normalizeChannelStatus.js';
import { enqueueConnect } from './channelQueue.service.js';
import { trackChannelState } from './channelStateTracker.js';
import { trackChannelState as trackChannelStateRedis } from './redisChannelStateTracker.js';
import { hasTenantFeature } from './tenantFeatures.service.js';

function deriveFinalStatus({ status, qr }) {
  if (qr) return 'waiting';
  if (status === 'connected') return 'connected';
  if (status === 'error') return 'error';
  return 'connecting';
}

function emitStateChanges(channel, state, previousState) {
  const changed = !previousState || previousState.status !== state.status || previousState.qr !== state.qr;
  if (!changed) return;

  emitChannelSocketEvent('connection:update', {
    channelId: channel.id,
    tenantId: channel.tenant_id,
    status: state.status,
    qr: state.qr,
  });
  if (state.qr) {
    emitChannelSocketEvent('qr:update', {
      channelId: channel.id,
      tenantId: channel.tenant_id,
      qr: state.qr,
    });
  }
  if (state.status === 'connected') {
    emitChannelSocketEvent('channel:connected', {
      channelId: channel.id,
      tenantId: channel.tenant_id,
    });
  }
}

async function resolveConnectionStateCore(channel, opts = {}) {
  const startedAt = Date.now();
  const providerType = String(channel.provider || '').toLowerCase().trim();
  const tenantId = channel.tenant_id;
  const channelId = channel.id;

  if (!tenantId || !channelId) {
    return {
      status: 'error',
      qr: null,
      provider: providerType || null,
      lastUpdate: Date.now(),
    };
  }

  if (!canAttempt(providerType)) {
    const circuit = getProviderCircuitState(providerType);
    return {
      status: 'error',
      qr: null,
      provider: providerType,
      lastUpdate: Date.now(),
      circuit,
    };
  }

  const provider = getChannelProvider(providerType, channel, {
    correlationId: opts.correlationId ?? null,
  });

  const [statusRaw, qrRaw] = await Promise.all([
    withTimeout(provider.getStatus(channel), 2000, { __timeoutFallback: 'error', operation: 'getStatus' }).catch(
      () => 'error',
    ),
    withTimeout(provider.getQr(channel), 3000, { __timeoutFallback: null, operation: 'getQr' }).catch(() => null),
  ]);

  const normalizedStatus = normalizeChannelStatus(providerType, statusRaw);
  const status = deriveFinalStatus({
    status: String(normalizedStatus || 'connecting').toLowerCase(),
    qr: qrRaw || null,
  });

  if (status === 'error') {
    markFailure(providerType);
    const allowAutoHeal = await hasTenantFeature(tenantId, 'autoHealing');
    if (allowAutoHeal) {
      Promise.resolve(
        enqueueConnect(channel, { reason: 'auto_healing', source: opts?.source || 'orchestrator' }),
      )
        .then((job) => {
          if (!job) return;
          log.warn({
            event: 'AUTO_HEALING_TRIGGERED',
            provider: providerType,
            context: 'channel_orchestrator',
            channelId,
            tenantId,
          });
        })
        .catch((err) => {
          log.error({
            event: 'PROVIDER_FAILURE',
            context: 'channel_orchestrator',
            provider: providerType,
            channelId,
            tenantId,
            error: err?.message || String(err),
          });
        });
    } else {
      log.warn({
        event: 'TENANT_FEATURE_BLOCKED',
        context: 'channel_orchestrator',
        tenantId,
        channelId,
        feature: 'autoHealing',
        requestId: opts?.correlationId ?? null,
        metadata: { provider: providerType },
      });
    }
  } else {
    markSuccess(providerType);
  }

  const state = {
    status,
    qr: qrRaw || null,
    provider: providerType,
    lastUpdate: Date.now(),
  };

  const previousState = getLastState(tenantId, channelId);
  setCachedState(tenantId, channelId, state);
  try {
    await trackChannelStateRedis({ tenantId, channelId, status: state.status });
  } catch (err) {
    log.warn({
      event: 'REDIS_TRACKER_FALLBACK',
      context: 'channel_orchestrator',
      tenantId,
      channelId,
      provider: providerType,
      metadata: { reason: err?.message || 'redis_unavailable' },
    });
    log.error({
      event: 'REDIS_TRACKER_WRITE_FAILED',
      context: 'channel_orchestrator',
      tenantId,
      channelId,
      provider: providerType,
      error: err?.message || String(err),
    });
    trackChannelState({ tenantId, channelId, status: state.status });
  }
  emitStateChanges(channel, state, previousState);
  if (!previousState || previousState.status !== state.status) {
    emitChannelSocketEvent('channel:status-change', {
      channelId,
      tenantId,
      provider: providerType,
      status: state.status,
      lastUpdate: state.lastUpdate,
    });
  }

  log.info({
    event: 'CHANNEL_STATE_RESOLVED',
    context: 'channel_orchestrator',
    channelId,
    tenantId,
    provider: providerType,
    status: state.status,
    duration: Date.now() - startedAt,
    metadata: { qr: Boolean(state.qr) },
  });

  return state;
}

export async function resolveConnectionState(channel, opts = {}) {
  const tenantId = channel?.tenant_id;
  const channelId = channel?.id;

  const cached = getCachedState(tenantId, channelId, 5000);
  if (cached) return cached;

  const inFlight = getInFlight(tenantId, channelId);
  if (inFlight) return inFlight;

  return setInFlight(tenantId, channelId, resolveConnectionStateCore(channel, opts));
}
