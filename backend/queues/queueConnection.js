import { createBullMQConnection } from '../services/redisClient.js';

/** @type {import('ioredis').default | null} */
let bullConnection = null;

export function getQueueConnection() {
  if (!bullConnection) {
    bullConnection = createBullMQConnection();
  }
  return {
    connection: bullConnection,
  };
}
