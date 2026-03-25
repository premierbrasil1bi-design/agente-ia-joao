/**
 * Idempotência de messages.upsert: evita enfileirar o mesmo evento duas vezes (Redis NX + TTL curto).
 * Se Redis falhar, processa (degradação segura).
 */

import { getRedisConnection } from '../queues/evolution.queue.js';

const PREFIX = 'evolution:webhook:msg:';
const TTL_SEC = parseInt(process.env.EVOLUTION_WEBHOOK_DEDUP_TTL_SEC || '300', 10);

/**
 * Monta chave estável a partir do payload Evolution/Baileys.
 * @param {object} payload
 * @returns {string|null}
 */
export function buildMessagesUpsertDedupKey(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const data = Array.isArray(payload.data) ? payload.data[0] : payload.data;
  const instance = String(
    payload.instance ?? payload.instanceName ?? payload.data?.instance ?? ''
  ).trim();
  const id = data?.key?.id != null ? String(data.key.id).trim() : '';
  const fromMe = data?.key?.fromMe === true ? '1' : '0';
  if (instance && id) {
    return `${PREFIX}${instance}:${id}:${fromMe}`;
  }
  const remoteJid = data?.key?.remoteJid != null ? String(data.key.remoteJid) : '';
  const ts = data?.messageTimestamp != null ? String(data.messageTimestamp) : '';
  const participant = data?.key?.participant != null ? String(data.key.participant) : '';
  if (instance && remoteJid && ts !== '') {
    return `${PREFIX}${instance}:${remoteJid}:${ts}:${participant}:${fromMe}`;
  }
  return null;
}

/**
 * @param {string|null} dedupKey
 * @returns {Promise<boolean>} true se este worker pode processar (primeira vez); false se duplicata
 */
export async function claimWebhookMessageOnce(dedupKey) {
  if (!dedupKey) return true;
  try {
    const r = getRedisConnection();
    const ok = await r.set(dedupKey, '1', 'EX', TTL_SEC, 'NX');
    return ok === 'OK';
  } catch (e) {
    console.warn('[EVOLUTION] dedup redis indisponível, processando mesmo assim:', e.message);
    return true;
  }
}
