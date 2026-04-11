import { Queue } from 'bullmq';
import { getRedisConnection } from './evolution.queue.js';

export const CHANNEL_CONNECTION_JOB = {
  CONNECT_CHANNEL: 'CONNECT_CHANNEL',
  DISCONNECT_CHANNEL: 'DISCONNECT_CHANNEL',
  RESTART_CHANNEL: 'RESTART_CHANNEL',
};

const QUEUE_NAME = 'channel-connection';
let channelConnectionQueue = null;

export function getChannelConnectionQueue() {
  if (!channelConnectionQueue) {
    channelConnectionQueue = new Queue(QUEUE_NAME, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    });
  }
  return channelConnectionQueue;
}

export function getChannelConnectionQueueName() {
  return QUEUE_NAME;
}
