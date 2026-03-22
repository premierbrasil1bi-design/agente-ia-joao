/**
 * Serviço de conexão de canais WhatsApp via Evolution API.
 * Orquestra criação de instância, QR, status e desconexão.
 * Criação idempotente (409 = instância já existe).
 */

import * as evolutionService from './evolutionService.js';
import * as channelRepo from '../repositories/channel.repository.js';
import { pool } from '../db/pool.js';
import { normalizeEvolutionState } from '../utils/evolutionState.js';
import { mapEvolutionStatus, toEvolutionStatusColumn } from '../utils/mapEvolutionStatus.js';
import { logger } from '../utils/logger.js';

/** Sanitiza string para nome de instância (apenas alfanumérico e _). */
function sanitizeInstancePart(s) {
  if (s == null || typeof s !== 'string') return 'unknown';
  return String(s).replace(/-/g, '_').replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 50) || 'unknown';
}

/**
 * Converte o campo instance do canal para nome de instância Evolution (slug).
 * Ex.: "Dra Ana Paula" → "dra_ana_paula"
 */
function slugifyInstance(instance) {
  if (instance == null || typeof instance !== 'string') return null;
  return String(instance)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .slice(0, 80) || null;
}

/**
 * Retorna o nome da instância Evolution para o canal.
 * Ordem: external_id (já salvo) → slugify(instance) → fallback via tenant/agent (connect).
 */
function getEvolutionInstanceName(channel) {
  if (channel?.external_id) return channel.external_id;
  const fromInstance = slugifyInstance(channel?.instance);
  if (fromInstance) return fromInstance;
  return null;
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

/** Corpo típico Evolution v2: { instance, hash, ... }; alguns proxies envolvem em `data`. */
function normalizeEvolutionCreateBody(body) {
  if (body == null || typeof body !== 'object') return body;
  if (body.instance != null) return body;
  if (body.data != null && typeof body.data === 'object' && body.data.instance != null) {
    return body.data;
  }
  return body;
}

function evolutionCreateHasInstance(body) {
  const b = normalizeEvolutionCreateBody(body);
  return b != null && b.instance != null;
}

/**
 * Cria (ou garante) a instância WhatsApp na Evolution para o canal,
 * sem conectar. Atualiza o canal com provider/external_id/status = created.
 * Fluxo: usado na criação do canal (POST /api/channels).
 */
export async function createWhatsAppInstance(channel) {
  const instanceName =
    (channel?.instance && slugifyInstance(channel.instance)) ||
    channel?.external_id ||
    (await instanceNameForChannel(channel));

  let createResponse;
  try {
    createResponse = await evolutionService.createInstance(instanceName);
  } catch (err) {
    if (err.response?.status === 409) {
      const raw = err.response?.data;
      console.log('Evolution response (409):', raw);
      createResponse = normalizeEvolutionCreateBody(raw);
      if (!evolutionCreateHasInstance(createResponse)) {
        createResponse = { instance: { instanceName, instanceId: instanceName } };
      }
    } else {
      throw err;
    }
  }

  createResponse = normalizeEvolutionCreateBody(createResponse);
  if (createResponse == null || createResponse.instance == null) {
    throw new Error('Evolution: resposta sem instance ao criar instância.');
  }

  const inst = createResponse.instance;
  const externalId =
    inst?.instanceId ||
    inst?.id ||
    inst?.instanceName ||
    createResponse?.instanceId ||
    instanceName;

  const rawEvolutionStatus = inst.status || inst.state || null;
  const normalizedStatus = mapEvolutionStatus(rawEvolutionStatus);
  console.log('[channels] evolution status raw:', rawEvolutionStatus);
  console.log('[channels] status normalized:', rawEvolutionStatus, '→', normalizedStatus);

  const updatedChannel = await channelRepo.updateConnection(channel.id, channel.tenant_id, {
    external_id: externalId,
    provider: 'evolution',
    status: normalizedStatus,
    evolution_status: toEvolutionStatusColumn(rawEvolutionStatus),
  });

  logger.instanceCreated(instanceName, channel.id);
  return {
    instanceName,
    createResponse,
    channel: updatedChannel,
  };
}

/**
 * Inicia conexão WhatsApp: garante instância criada e chama Evolution para conectar (gera QR).
 * Se a instância já existir (409), createWhatsAppInstance trata de forma idempotente.
 * Usado por POST /channels/:id/connect e GET /channels/:id/qrcode (via serviço).
 */
export async function connectWhatsAppChannel(channel) {
  const { instanceName, createResponse } = await createWhatsAppInstance(channel);

  const connectResponse = await evolutionService.connectInstance(instanceName);

  const connectingDbStatus = mapEvolutionStatus('connecting');
  console.log('[channels] status normalized:', 'connecting', '→', connectingDbStatus);

  const updatedChannel = await channelRepo.updateConnection(channel.id, channel.tenant_id, {
    external_id: instanceName,
    provider: 'evolution',
    status: connectingDbStatus,
    evolution_status: 'connecting',
  });

  return {
    instanceName,
    createResponse,
    connectResponse,
    channel: updatedChannel,
  };
}

/**
 * Obtém QR Code para o canal.
 * Usa external_id ou slug do campo instance (permite QR sem ter clicado Connect antes).
 */
export async function getChannelQrCode(channel) {
  const instanceName = getEvolutionInstanceName(channel) || (channel?.instance ? slugifyInstance(channel.instance) : null);
  if (!instanceName) {
    throw new Error('Configure o campo Instance do canal (ex.: Dra Ana Paula).');
  }
  return evolutionService.getQrCode(instanceName);
}

/**
 * Obtém status na Evolution e atualiza banco com status normalizado (connected/disconnected/connecting).
 */
export async function getChannelStatus(channel) {
  const instanceName = getEvolutionInstanceName(channel) || (channel?.instance ? slugifyInstance(channel.instance) : null);
  if (!instanceName) {
    return { normalizedStatus: 'unknown', channel };
  }

  const state = await evolutionService.getInstanceStatus(instanceName);
  const rawState = state?.state ?? state?.instance?.state ?? null;
  const normalizedStatus = normalizeEvolutionState(rawState);
  const dbStatus = mapEvolutionStatus(rawState);
  console.log('[channels] status normalized:', rawState, '→', dbStatus);

  const previousStatus = channel.status ?? null;
  if (dbStatus !== previousStatus) {
    logger.statusChange(instanceName, channel.id, previousStatus, normalizedStatus);
  }

  const updatedChannel = await channelRepo.updateConnection(channel.id, channel.tenant_id, {
    status: dbStatus,
    evolution_status: toEvolutionStatusColumn(rawState),
    ...(dbStatus === 'active' ? { connected_at: new Date(), last_error: null } : {}),
  });

  return { normalizedStatus, state, channel: updatedChannel ?? channel };
}

/**
 * Desconecta instância na Evolution e atualiza banco.
 */
export async function disconnectChannel(channel) {
  const instanceName = getEvolutionInstanceName(channel) || (channel?.instance ? slugifyInstance(channel.instance) : null);
  if (!instanceName) {
    await channelRepo.updateConnection(channel.id, channel.tenant_id, {
      status: mapEvolutionStatus('disconnected'),
      evolution_status: 'disconnected',
    });
    return;
  }

  try {
    await evolutionService.disconnectInstance(instanceName);
  } catch (err) {
    console.error('[channelConnection] disconnectInstance error:', err.message);
  }

  await channelRepo.updateConnection(channel.id, channel.tenant_id, {
    status: mapEvolutionStatus('disconnected'),
    evolution_status: 'disconnected',
    external_id: null,
    connected_at: null,
  });
  logger.statusChange(instanceName, channel.id, channel.status, 'disconnected');
}
