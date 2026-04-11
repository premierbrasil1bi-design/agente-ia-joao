import { CHANNEL_CONNECTION_JOB, getChannelConnectionQueue } from '../queues/channelConnection.queue.js';
import { log } from '../utils/logger.js';
import * as tenantLimits from './tenantLimits.service.js';

function makePayload(channel) {
  return {
    tenantId: String(channel?.tenant_id || ''),
    channelId: String(channel?.id || ''),
    provider: String(channel?.provider || '').toLowerCase().trim(),
  };
}

async function enqueue(jobName, channel, metadata = {}) {
  const payload = makePayload(channel);
  if (!payload.tenantId || !payload.channelId || !payload.provider) {
    log.warn({
      event: 'CHANNEL_JOB_SKIPPED_INVALID_PAYLOAD',
      context: 'service',
      tenantId: payload.tenantId || null,
      channelId: payload.channelId || null,
      provider: payload.provider || null,
      metadata,
    });
    return null;
  }

  const gated =
    jobName === CHANNEL_CONNECTION_JOB.CONNECT_CHANNEL ||
    jobName === CHANNEL_CONNECTION_JOB.RESTART_CHANNEL;
  if (gated) {
    const decision = await tenantLimits.canEnqueueConnectionJob(payload.tenantId, {
      requestId: metadata.requestId ?? null,
    });
    if (!decision.allowed) {
      log.warn({
        event: 'CHANNEL_JOB_BLOCKED_PLAN',
        context: 'service',
        tenantId: payload.tenantId,
        channelId: payload.channelId,
        provider: payload.provider,
        metadata: {
          jobName,
          reason: decision.reason,
          code: 'TENANT_PLAN_LIMIT',
          ...metadata,
        },
      });
      return null;
    }
  }

  const queue = getChannelConnectionQueue();
  const dedupeKey = `${jobName}:${payload.tenantId}:${payload.channelId}`;
  const job = await queue.add(jobName, payload, { jobId: dedupeKey });
  log.info({
    event: 'CHANNEL_JOB_ENQUEUED',
    context: 'service',
    tenantId: payload.tenantId,
    channelId: payload.channelId,
    provider: payload.provider,
    metadata: { jobName, jobId: job.id, ...metadata },
  });
  return job;
}

export async function enqueueConnect(channel, metadata = {}) {
  return enqueue(CHANNEL_CONNECTION_JOB.CONNECT_CHANNEL, channel, metadata);
}

export async function enqueueDisconnect(channel, metadata = {}) {
  return enqueue(CHANNEL_CONNECTION_JOB.DISCONNECT_CHANNEL, channel, metadata);
}

export async function enqueueRestart(channel, metadata = {}) {
  return enqueue(CHANNEL_CONNECTION_JOB.RESTART_CHANNEL, channel, metadata);
}
