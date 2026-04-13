import { Worker } from 'bullmq';
import { getQueueConnection } from '../queues/queueConnection.js';
import { ensureSession } from '../services/sessionOrchestrator.js';
import { emitEvent } from '../utils/socketEmitter.js';

const { connection } = getQueueConnection();

const worker = new Worker(
  'session-queue',
  async (job) => {
    const { provider, sessionName, channelId, tenantId } = job.data;
    emitEvent('session:update', {
      sessionName,
      provider,
      status: 'processing',
    });

    console.log({
      event: 'WORKER_PROCESS_START',
      sessionName,
      provider,
    });

    const result = await ensureSession({
      provider,
      sessionName,
      channelId,
      tenantId,
    });

    console.log({
      event: 'WORKER_PROCESS_DONE',
      result,
    });
    emitEvent('session:updated', result);

    return result;
  },
  { connection },
);

worker.on('failed', (job, err) => {
  console.error({
    event: 'WORKER_FAILED',
    jobId: job?.id ?? null,
    error: err?.message || String(err),
  });
});
