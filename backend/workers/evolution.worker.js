import { Worker } from 'bullmq';
import {
  getRedisConnection,
  EVOLUTION_JOB,
  serializeAxiosErrorForJob,
} from '../queues/evolution.queue.js';
import * as http from '../services/evolutionHttp.client.js';
import { evolutionLog } from '../utils/evolutionLog.js';

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
 * Inicia o consumer BullMQ. Idempotente: se já existir, não duplica.
 */
export function startEvolutionWorker() {
  if (worker) {
    console.warn('[evolution-worker] já iniciado, ignorando start duplicado');
    return worker;
  }

  worker = new Worker(
    'evolution-api',
    async (job) => {
      const d = job.data || {};
      switch (job.name) {
        case EVOLUTION_JOB.CREATE:
          return wrap('CREATE', d.instanceName, () => http.createInstance(d.instanceName));
        case EVOLUTION_JOB.CONNECT:
          return wrap('CONNECT', d.instanceName, () => http.connectInstance(d.instanceName));
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
        /** Smoke-test da fila no deploy (scripts/deploy.sh); não chama Evolution. */
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

  worker.on('failed', (job, err) => {
    evolutionLog('JOB_FAILED', job?.data?.instanceName ?? job?.data?.instance ?? '-', {
      jobId: job?.id,
      name: job?.name,
      error: err?.message,
    });
  });

  console.log(`[evolution-worker] ativo (concurrency=${concurrency})`);
  return worker;
}

export async function stopEvolutionWorker() {
  if (worker) {
    await worker.close();
    worker = null;
  }
}
