import { Queue } from 'bullmq';
import { getRedisConnection } from './evolution.queue.js';

const QUEUE_NAME = 'channel-provisioning';
let queue = null;

export function getProvisioningQueue() {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { age: 3600, count: 2000 },
        removeOnFail: { age: 86400, count: 1000 },
      },
    });
  }
  return queue;
}

export const provisioningQueue = getProvisioningQueue();
