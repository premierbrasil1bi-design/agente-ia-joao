import { getRedis } from '../services/redisClient.js';

export function getQueueConnection() {
  const redis = getRedis();
  return {
    connection: redis,
  };
}
