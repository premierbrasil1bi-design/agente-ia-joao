/**
 * Evolution API 2.x – WhatsApp (WHATSAPP-BAILEYS).
 * Todas as chamadas HTTP passam pela fila BullMQ + worker (nunca axios direto aqui).
 * Header apikey: EVOLUTION_API_KEY.
 */

import { EvolutionCircuitBreaker } from '../utils/evolutionCircuitBreaker.js';
import { evolutionLog } from '../utils/evolutionLog.js';
import {
  EVOLUTION_JOB,
  addEvolutionJobAndWait,
} from '../queues/evolution.queue.js';

const breaker = new EvolutionCircuitBreaker({
  failureThreshold: parseInt(process.env.EVOLUTION_CIRCUIT_FAILURES || '5', 10),
  openDurationMs: parseInt(process.env.EVOLUTION_CIRCUIT_OPEN_MS || '45000', 10),
});

async function throughQueue(jobName, data, options = {}) {
  return breaker.execute(() => addEvolutionJobAndWait(jobName, data, options));
}

/**
 * POST /instance/create
 */
export async function createInstance(instanceName) {
  evolutionLog('CREATE', instanceName);
  return throughQueue(EVOLUTION_JOB.CREATE, { instanceName }, { timeoutMs: 120000 });
}

/**
 * GET /instance/logout/:instance — se 405, tenta DELETE (versões antigas).
 */
export async function disconnectInstance(instanceName) {
  evolutionLog('DISCONNECT', instanceName);
  return throughQueue(EVOLUTION_JOB.DISCONNECT, { instanceName }, { timeoutMs: 90000 });
}

/**
 * Fluxo obrigatório: disconnect (ignora erro) → connect — evita instância presa em "close".
 */
export async function connectInstance(instanceName) {
  evolutionLog('CONNECT', instanceName);
  return throughQueue(EVOLUTION_JOB.CONNECT, { instanceName }, { timeoutMs: 180000 });
}

/**
 * GET /instance/qrcode/:instance
 */
export async function getQRCode(instanceName) {
  evolutionLog('QRCODE', instanceName);
  return throughQueue(EVOLUTION_JOB.QRCODE, { instanceName }, { timeoutMs: 180000 });
}

export async function getQrCode(instanceName) {
  return getQRCode(instanceName);
}

/**
 * GET /instance/connectionState/:instance
 */
export async function getConnectionStatus(instanceName) {
  evolutionLog('STATUS', instanceName);
  return throughQueue(EVOLUTION_JOB.STATUS, { instanceName }, { timeoutMs: 90000 });
}

export const getStatus = getConnectionStatus;

export async function getInstanceStatus(instanceName) {
  return getConnectionStatus(instanceName);
}

/**
 * DELETE /instance/delete/:instance
 */
export async function deleteInstance(instanceName) {
  evolutionLog('DELETE', instanceName);
  return throughQueue(EVOLUTION_JOB.DELETE, { instanceName }, { timeoutMs: 120000 });
}

export async function sendText(instance, number, text) {
  evolutionLog('SEND_TEXT', instance, { number });
  return throughQueue(
    EVOLUTION_JOB.SEND_TEXT,
    { instance, number, text },
    { timeoutMs: 60000, priority: 1 }
  );
}

/**
 * Health real: GET /instance/fetchInstances (via fila).
 */
export async function checkEvolutionHealth() {
  evolutionLog('HEALTH', null);
  return throughQueue(EVOLUTION_JOB.HEALTH, {}, { timeoutMs: 35000 });
}
