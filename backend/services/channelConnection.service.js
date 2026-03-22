/**
 * Serviço de conexão de canais WhatsApp via Evolution API.
 * Orquestra conexão, QR, status e desconexão.
 * Criação na Evolution: apenas fluxo explícito (createWhatsAppInstance), nunca automática em status/connect.
 */

import * as evolutionService from './evolutionService.js';
import * as channelRepo from '../repositories/channel.repository.js';
import { normalizeEvolutionState } from '../utils/evolutionState.js';
import { mapEvolutionStatus, toEvolutionStatusColumn } from '../utils/mapEvolutionStatus.js';
import { logger } from '../utils/logger.js';
import { DEFAULT_EVOLUTION_INSTANCE_NAME } from '../config/evolutionInstance.js';

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
 * Ordem: external_id → slugify(instance) → nome padrão global (uma instância canônica).
 */
function getEvolutionInstanceName(channel) {
  const ext = channel?.external_id != null ? String(channel.external_id).trim() : '';
  if (ext) return ext;
  const fromInstance = slugifyInstance(channel?.instance);
  if (fromInstance) return fromInstance;
  return DEFAULT_EVOLUTION_INSTANCE_NAME;
}

/** Coleta nomes de instância a partir da resposta de fetchInstances (formatos variados da Evolution). */
function collectInstanceNamesFromFetch(data) {
  const names = new Set();
  const seen = new WeakSet();

  function visit(obj, depth) {
    if (depth > 12 || obj == null) return;
    if (typeof obj !== 'object') return;
    if (seen.has(obj)) return;
    seen.add(obj);

    if (Array.isArray(obj)) {
      obj.forEach((item) => visit(item, depth + 1));
      return;
    }

    const candidates = [
      obj.instanceName,
      obj.name,
      obj.instance?.instanceName,
      obj.instance?.name,
    ];
    for (const n of candidates) {
      if (typeof n === 'string' && n.trim()) names.add(n.trim());
    }

    for (const v of Object.values(obj)) {
      if (v && typeof v === 'object') visit(v, depth + 1);
    }
  }

  visit(data, 0);
  return names;
}

async function evolutionAlreadyHasInstance(instanceName) {
  try {
    const data = await evolutionService.checkEvolutionHealth();
    return collectInstanceNamesFromFetch(data).has(instanceName);
  } catch {
    return false;
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
 * Cria (ou associa) a instância WhatsApp na Evolution para o canal, sem conectar.
 * Chamada explícita apenas — não é usada em status nem em connect automático.
 * Se a instância já existir na Evolution, não chama POST /instance/create.
 */
export async function createWhatsAppInstance(channel) {
  const instanceName =
    String(channel?.external_id || '').trim() ||
    slugifyInstance(channel?.instance) ||
    DEFAULT_EVOLUTION_INSTANCE_NAME;

  if (await evolutionAlreadyHasInstance(instanceName)) {
    console.warn('[evolution] Instância já existe na Evolution; não chama /instance/create:', instanceName);
    const updatedChannel = await channelRepo.updateConnection(channel.id, channel.tenant_id, {
      external_id: instanceName,
      provider: 'evolution',
      status: mapEvolutionStatus('disconnected'),
      evolution_status: 'disconnected',
    });
    return {
      instanceName,
      createResponse: { skipped: true, reason: 'instance_already_exists' },
      channel: updatedChannel,
    };
  }

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
 * POST connect: exige external_id já persistido (instância criada manualmente / fluxo explícito).
 * Não cria instância automaticamente.
 */
export async function connectWhatsAppChannel(channel) {
  const tenantId = channel.tenant_id;
  const ext = channel.external_id != null ? String(channel.external_id).trim() : '';

  if (!ext) {
    console.warn('Tentativa de criação automática bloqueada');
    const err = new Error('Instance not created');
    err.code = 'INSTANCE_NOT_FOUND';
    throw err;
  }

  const instanceName = ext;

  console.log('[evolution] CONNECT START', instanceName);
  const connectResponse = await evolutionService.connectInstance(instanceName);
  console.log('[evolution] CONNECT DONE', instanceName);

  const connectingDbStatus = mapEvolutionStatus('connecting');
  console.log('[channels] connectWhatsAppChannel → connecting DB:', connectingDbStatus);

  const updatedChannel = await channelRepo.updateConnection(channel.id, tenantId, {
    external_id: instanceName,
    provider: 'evolution',
    status: connectingDbStatus,
    evolution_status: 'connecting',
  });

  return {
    instanceName,
    createResponse: null,
    connectResponse,
    channel: updatedChannel,
  };
}

/**
 * Obtém QR Code para o canal (instância já deve existir na Evolution).
 */
export async function getChannelQrCode(channel) {
  const instanceName = getEvolutionInstanceName(channel);

  console.log('[evolution] PRE-QR connectInstance', instanceName);
  await evolutionService.connectInstance(instanceName);

  return await evolutionService.getQRCode(instanceName);
}

/**
 * Obtém status na Evolution e atualiza banco com status normalizado (connected/disconnected/connecting).
 * Nunca cria instância em resposta a 404 ou ausência na Evolution.
 */
export async function getChannelStatus(channel) {
  const instanceName = getEvolutionInstanceName(channel);

  try {
    let state = await evolutionService.getStatus(instanceName);
    let rawState = state?.state ?? state?.instance?.state ?? null;
    let rawLower = rawState != null ? String(rawState).trim().toLowerCase() : '';

    if (rawLower === 'close') {
      console.log('[channelConnection] state=close → connectInstance', instanceName);
      await evolutionService.connectInstance(instanceName);
      state = await evolutionService.getStatus(instanceName);
      rawState = state?.state ?? state?.instance?.state ?? null;
      rawLower = rawState != null ? String(rawState).trim().toLowerCase() : '';
    }

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
  } catch (err) {
    const code = err.code;
    const axStatus = err.response?.status;
    console.error('[channelConnection] getChannelStatus Evolution:', err.message, code || axStatus || '');

    if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ETIMEDOUT') {
      return {
        normalizedStatus: 'unknown',
        state: null,
        channel,
        evolutionOffline: true,
        error: 'Evolution API indisponível. Verifique se o serviço está em execução.',
      };
    }

    if (axStatus === 404) {
      console.warn('Tentativa de criação automática bloqueada');
      return {
        normalizedStatus: 'unknown',
        state: null,
        channel,
        instanceNotFound: true,
        code: 'INSTANCE_NOT_FOUND',
        message: 'Instance not created',
      };
    }

    return {
      normalizedStatus: 'unknown',
      state: null,
      channel,
      evolutionOffline: true,
      error: err.message || 'Evolution API temporariamente indisponível',
    };
  }
}

/**
 * Desconecta instância na Evolution e atualiza banco.
 * Só chama a Evolution se houver external_id (evita logout no nome padrão sem vínculo real).
 */
export async function disconnectChannel(channel) {
  const ext = channel?.external_id != null ? String(channel.external_id).trim() : '';

  if (!ext) {
    await channelRepo.updateConnection(channel.id, channel.tenant_id, {
      status: mapEvolutionStatus('disconnected'),
      evolution_status: 'disconnected',
    });
    return;
  }

  try {
    await evolutionService.disconnectInstance(ext);
  } catch (err) {
    console.error('[channelConnection] disconnectInstance error:', err.message);
  }

  await channelRepo.updateConnection(channel.id, channel.tenant_id, {
    status: mapEvolutionStatus('disconnected'),
    evolution_status: 'disconnected',
    external_id: null,
    connected_at: null,
  });
  logger.statusChange(ext, channel.id, channel.status, 'disconnected');
}
