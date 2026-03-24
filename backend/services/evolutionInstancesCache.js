/**
 * Cache Redis para GET /instance/fetchInstances (via fila BullMQ).
 * - TTL configurável (10–30s)
 * - Uma única requisição em voo por vez (singleflight) para evitar rajadas na Evolution
 */

import { getRedisConnection } from '../queues/evolution.queue.js';

const CACHE_KEY = 'evolution:instances:fetch:v1';

function getTtlSeconds() {
  const raw = parseInt(process.env.EVOLUTION_INSTANCES_CACHE_TTL_SEC || '20', 10);
  if (Number.isNaN(raw)) return 20;
  return Math.min(30, Math.max(10, raw));
}

/** Serializa apenas o caminho “cache miss” para evitar N chamadas simultâneas à Evolution. */
let mutexChain = Promise.resolve();

function withEvolutionFetchLock(fn) {
  const next = mutexChain.then(() => fn());
  mutexChain = next.catch(() => {});
  return next;
}

async function redisGet(key) {
  try {
    const r = getRedisConnection();
    return await r.get(key);
  } catch (e) {
    console.warn('[evolution-instances-cache] GET:', e.message);
    return null;
  }
}

async function redisSet(key, value, ttlSec) {
  try {
    const r = getRedisConnection();
    await r.set(key, value, 'EX', ttlSec);
  } catch (e) {
    console.warn('[evolution-instances-cache] SET:', e.message);
  }
}

/**
 * Retorna o payload bruto de fetchInstances, com cache Redis e fila única em cache miss.
 * @param {() => Promise<unknown>} fetchRaw - ex.: throughQueue(HEALTH)
 */
export async function fetchEvolutionInstancesWithCache(fetchRaw) {
  const ttlSec = getTtlSeconds();

  const cachedStr = await redisGet(CACHE_KEY);
  if (cachedStr) {
    try {
      return JSON.parse(cachedStr);
    } catch {
      /* refetch se JSON corrompido */
    }
  }

  return withEvolutionFetchLock(async () => {
    const again = await redisGet(CACHE_KEY);
    if (again) {
      try {
        return JSON.parse(again);
      } catch {
        /* segue para API */
      }
    }
    const data = await fetchRaw();
    await redisSet(CACHE_KEY, JSON.stringify(data), ttlSec);
    return data;
  });
}

/** Invalida cache após criar/remover instância manualmente (opcional). */
export async function invalidateEvolutionInstancesCache() {
  try {
    await getRedisConnection().del(CACHE_KEY);
  } catch (e) {
    console.warn('[evolution-instances-cache] DEL:', e.message);
  }
}
