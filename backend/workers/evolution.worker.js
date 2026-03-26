import { fileURLToPath } from 'url';
import path from 'path';
import { Worker } from 'bullmq';
import {
  getRedisConnection,
  getRedisUrl,
  initEvolutionQueueInfra,
  EVOLUTION_JOB,
  serializeAxiosErrorForJob,
} from '../queues/evolution.queue.js';
import * as http from '../services/evolutionHttp.client.js';
import { evolutionLog } from '../utils/evolutionLog.js';

const QUEUE_NAME = 'evolution-api';

const concurrency = Math.max(
  1,
  Math.min(20, parseInt(process.env.EVOLUTION_WORKER_CONCURRENCY || '3', 10) || 3)
);

/** @type {Worker | null} */
let worker = null;

async function wrap(name, instanceLabel, fn) {
  try {
    evolutionLog(`${name}_JOB_START`, instanceLabel);
    const out = await fn();
    evolutionLog(`${name}_JOB_DONE`, instanceLabel);
    return out;
  } catch (e) {
    evolutionLog(`${name}_JOB_FAIL`, instanceLabel, { error: e?.message });
    throw serializeAxiosErrorForJob(e);
  }
}

/**
 * Inicia o consumer BullMQ na fila `evolution-api` (mesmo nome que evolution.queue.js).
 * Idempotente: se já existir, não duplica.
 */
export function startEvolutionWorker() {
  if (worker) {
    console.warn('[evolution-worker] já iniciado, ignorando start duplicado');
    return worker;
  }

  worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      console.log('Processando job', job.id, job.name);
      const d = job.data || {};
      switch (job.name) {
        case EVOLUTION_JOB.CREATE:
          return wrap('CREATE', d.instanceName, () => http.createInstance(d.instanceName));
        case EVOLUTION_JOB.CONNECT:
          if (d.reset === true) {
            return wrap('CONNECT_RESET', d.instanceName, () => http.connectInstanceWithReset(d.instanceName));
          }
          return wrap('CONNECT_SOFT', d.instanceName, () => http.connectInstanceSoft(d.instanceName));
        case EVOLUTION_JOB.QRCODE:
          return wrap('QRCODE', d.instanceName, () => http.getQRCode(d.instanceName));
        case EVOLUTION_JOB.DELETE:
          return wrap('DELETE', d.instanceName, () => http.deleteInstance(d.instanceName));
        case EVOLUTION_JOB.STATUS:
          return wrap('STATUS', d.instanceName, () => http.getConnectionStatus(d.instanceName));
        case EVOLUTION_JOB.DISCONNECT:
          return wrap('DISCONNECT', d.instanceName, () => http.disconnectInstance(d.instanceName));
        case EVOLUTION_JOB.SEND_TEXT:
          return wrap('SEND_TEXT', d.instance, () =>
            http.sendText(d.instance, d.number, d.text)
          );
        case EVOLUTION_JOB.HEALTH:
          return wrap('HEALTH', null, () => http.fetchInstances());
        case 'health-check':
          return { ok: true, source: 'deploy-check', ts: d.ts ?? null };
        default:
          throw new Error(`Job desconhecido: ${job.name}`);
      }
    },
    {
      connection: getRedisConnection(),
      concurrency,
    }
  );

  worker.on('completed', (job) => {
    console.log('Job concluído', job.id, job.name);
  });

  worker.on('failed', (job, err) => {
    console.error('Erro no job', job?.id, job?.name, err?.message);
    evolutionLog('JOB_FAILED', job?.data?.instanceName ?? job?.data?.instance ?? '-', {
      jobId: job?.id,
      name: job?.name,
      error: err?.message,
    });
  });

  console.log(`[evolution-worker] ativo fila=${QUEUE_NAME} concurrency=${concurrency}`);
  return worker;
}

export async function stopEvolutionWorker() {
  if (worker) {
    await worker.close();
    worker = null;
  }
}

function isExecutedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return path.resolve(entry) === path.resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

async function bootstrapStandaloneWorker() {
  console.log('Worker evolution iniciado');
  const url = getRedisUrl();
  if (!process.env.REDIS_HOST || !process.env.REDIS_PORT) {
    console.error('[evolution-worker] REDIS_HOST/REDIS_PORT ausentes — configure no ambiente');
    process.exit(1);
  }
  console.log('[evolution-worker] Redis endpoint:', url);
  await initEvolutionQueueInfra();
  await getRedisConnection().ping();
  console.log('Conectado ao Redis');
  startEvolutionWorker();
}

if (isExecutedDirectly()) {
  (async () => {
    await import('../bootstrap/dns-ipv4first.js');
    await import('dotenv/config');
    await bootstrapStandaloneWorker();
  })().catch((err) => {
    console.error('[evolution-worker] falha ao subir:', err);
    process.exit(1);
  });
}
