/**
 * Serviço de conexão de canais WhatsApp via Evolution API.
 * Orquestra criação de instância, QR, status e desconexão.
 * Nome da instância: tenantSlug_agentSlug_channelId (contexto tenant + agent).
 */

import * as evolutionService from './evolutionService.js';
import * as channelRepo from '../repositories/channel.repository.js';
import { pool } from '../db/pool.js';

/** Sanitiza string para nome de instância (apenas alfanumérico e _). */
function sanitizeInstancePart(s) {
  if (s == null || typeof s !== 'string') return 'unknown';
  return String(s).replace(/-/g, '_').replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 50) || 'unknown';
}

/**
 * Gera o nome da instância no formato tenantSlug_agentSlug_channelId.
 * Garante contexto tenant_id e agent_id. Fallback: omnia_{channelId}.
 */
async function instanceNameForChannel(channel) {
  try {
    const { rows } = await pool.query(
      `SELECT t.slug AS tenant_slug, a.slug AS agent_slug
       FROM channels c
       JOIN tenants t ON t.id = c.tenant_id
       JOIN agents a ON a.id = c.agent_id
       WHERE c.id = $1 AND c.tenant_id = $2`,
      [channel.id, channel.tenant_id]
    );
    const row = rows[0];
    const tenantSlug = row ? sanitizeInstancePart(row.tenant_slug) : 'tenant';
    const agentSlug = row ? sanitizeInstancePart(row.agent_slug) : 'agent';
    const channelPart = sanitizeInstancePart(String(channel.id));
    return `${tenantSlug}_${agentSlug}_${channelPart}`;
  } catch (err) {
    console.warn('[channelConnection] instanceNameForChannel fallback:', err.message);
    return `omnia_${sanitizeInstancePart(String(channel.id))}`;
  }
}

/**
 * Inicia conexão WhatsApp: cria instância na Evolution e persiste estado.
 * @param {object} channel - canal com id, tenant_id
 * @returns {Promise<{ instanceName: string }>}
 */
export async function connectWhatsAppChannel(channel) {
  const instanceName = await instanceNameForChannel(channel);

  await evolutionService.createInstance(instanceName);

  await channelRepo.updateConnection(channel.id, channel.tenant_id, {
    external_id: instanceName,
    provider: 'evolution',
    status: 'connecting',
  });

  console.log('[channelConnection] Instance created:', instanceName, 'channel:', channel.id);
  return instanceName;
}

/**
 * Obtém QR Code para o canal (usa external_id = instanceName).
 */
export async function getChannelQrCode(channel) {
  if (!channel?.external_id) {
    throw new Error('Canal sem external_id (instância não criada).');
  }
  return evolutionService.getQrCode(channel.external_id);
}

/**
 * Obtém status na Evolution e atualiza banco se status = "open".
 */
export async function getChannelStatus(channel) {
  if (!channel?.external_id) {
    return { state: null, channel };
  }

  const state = await evolutionService.getInstanceStatus(channel.external_id);

  if (state?.state === 'open' || state?.instance?.state === 'open') {
    await channelRepo.updateConnection(channel.id, channel.tenant_id, {
      status: 'connected',
      connected_at: new Date(),
      last_error: null,
    });
  }

  return { state, channel };
}

/**
 * Desconecta instância na Evolution e atualiza banco.
 */
export async function disconnectChannel(channel) {
  if (!channel?.external_id) {
    await channelRepo.updateConnection(channel.id, channel.tenant_id, { status: 'disconnected' });
    return;
  }

  try {
    await evolutionService.disconnectInstance(channel.external_id);
  } catch (err) {
    console.error('[channelConnection] disconnectInstance error:', err.message);
  }

  await channelRepo.updateConnection(channel.id, channel.tenant_id, {
    status: 'disconnected',
    external_id: null,
    connected_at: null,
  });
  console.log('[channelConnection] Disconnected channel:', channel.id);
}
