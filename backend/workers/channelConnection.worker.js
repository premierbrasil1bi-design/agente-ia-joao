import { Worker } from 'bullmq';
import { getRedisConnection } from '../queues/evolution.queue.js';
import {
  CHANNEL_CONNECTION_JOB,
  getChannelConnectionQueueName,
} from '../queues/channelConnection.queue.js';
import * as channelRepo from '../repositories/channel.repository.js';
import { getProvider as getChannelProvider } from '../services/channelProviders/providerFactory.js';
import { resolveConnectionState } from '../services/channelOrchestrator.js';
import { log } from '../utils/logger.js';

async function executeJob(job) {
  const payload = job?.data || {};
  const tenantId = String(payload.tenantId || '').trim();
  const channelId = String(payload.channelId || '').trim();
  const provider = String(payload.provider || '').toLowerCase().trim() || null;

  if (!tenantId || !channelId || !provider) {
    throw new Error('INVALID_CHANNEL_JOB_PAYLOAD');
  }

  log.info({
    event: 'CHANNEL_CONNECT_JOB_STARTED',
    context: 'service',
    tenantId,
    channelId,
    provider,
    metadata: { jobId: job.id, jobName: job.name },
  });

  const channel = await channelRepo.findById(channelId, tenantId);
  if (!channel) {
    throw new Error('CHANNEL_NOT_FOUND_FOR_JOB');
  }

  const providerImpl = getChannelProvider(provider, channel);
  if (job.name === CHANNEL_CONNECTION_JOB.CONNECT_CHANNEL) {
    await providerImpl.start(channel);
  } else if (job.name === CHANNEL_CONNECTION_JOB.DISCONNECT_CHANNEL) {
    await providerImpl.stop(channel);
  } else if (job.name === CHANNEL_CONNECTION_JOB.RESTART_CHANNEL) {
    await providerImpl.stop(channel);
    await providerImpl.start(channel);
  } else {
    throw new Error(`UNSUPPORTED_JOB_NAME:${job.name}`);
  }

  await resolveConnectionState(channel, { source: 'worker' });

  log.info({
    event: 'CHANNEL_CONNECT_JOB_SUCCESS',
    context: 'service',
    tenantId,
    channelId,
    provider,
    metadata: { jobId: job.id, jobName: job.name },
  });
}

const worker = new Worker(getChannelConnectionQueueName(), executeJob, {
  connection: getRedisConnection(),
});

worker.on('failed', (job, err) => {
  const payload = job?.data || {};
  log.error({
    event: 'CHANNEL_CONNECT_JOB_FAILED',
    context: 'service',
    tenantId: payload?.tenantId || null,
    channelId: payload?.channelId || null,
    provider: payload?.provider || null,
    error: err?.message || String(err),
    stack: err?.stack,
    metadata: { jobId: job?.id || null, jobName: job?.name || null },
  });
});

