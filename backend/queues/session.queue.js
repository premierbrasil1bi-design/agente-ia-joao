import { Queue } from 'bullmq';
import { getQueueConnection } from './queueConnection.js';

const { connection } = getQueueConnection();

export const sessionQueue = new Queue('session-queue', {
  connection,
});

export async function enqueueSessionRecovery(payload) {
  try {
    const job = await sessionQueue.add('recover-session', payload, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
      removeOnComplete: true,
      removeOnFail: false,
    });

    console.log({
      event: 'QUEUE_JOB_ADDED',
      payload,
      jobId: job?.id ?? null,
    });
    return { queued: true, jobId: job?.id ?? null };
  } catch (err) {
    console.error('QUEUE_ADD_FAIL', err?.message || String(err));
    throw err;
  }
}
