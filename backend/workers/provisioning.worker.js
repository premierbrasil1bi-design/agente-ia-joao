import { Worker } from 'bullmq';
import { getRedisConnection } from '../queues/evolution.queue.js';
import { provisionChannel } from '../services/channelProvisioning.service.js';

const connection = getRedisConnection();

const worker = new Worker(
  'channel-provisioning',
  async (job) => {
    const channel = job?.data?.channel;
    if (!channel) return;
    console.log('[WORKER] Reprocessando canal:', channel.id);
    await provisionChannel(channel);
  },
  { connection },
);

worker.on('completed', (job) => {
  console.log('[WORKER] Provision reprocessado com sucesso:', job.id);
});

worker.on('failed', (job, err) => {
  console.error('[WORKER] Falha no reprocessamento:', job?.id, err?.message || err);
});
