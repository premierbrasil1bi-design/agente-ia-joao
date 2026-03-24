/**
 * Serviço de conexão de canais WhatsApp via Evolution API.
 * Orquestra conexão, QR, status e desconexão.
 * Associação à Evolution: instância deve existir previamente (createWhatsAppInstance só persiste vínculo).
 */

import * as evolutionService from './evolutionService.js';
import * as channelRepo from '../repositories/channel.repository.js';
import { normalizeEvolutionState } from '../utils/evolutionState.js';
import { mapEvolutionStatus, toEvolutionStatusColumn } from '../utils/mapEvolutionStatus.js';
import { logger } from '../utils/logger.js';
import { DEFAULT_EVOLUTION_INSTANCE_NAME } from '../config/evolutionInstance.js';
import { extractQrPayload, toQrDataUrl } from '../utils/extractQrPayload.js';
import {
  WHATSAPP_PHASE,
  mergeWhatsappConfig,
  getWhatsappFlow,
  canAutoConnect,
  deriveFlowPhase,
} from '../utils/whatsappChannelFlow.js';

const MAX_WHATSAPP_ARTIFACT_LEN = 150000;

function pickPairingCodeFromPayload(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const c =
    (typeof raw.pairingCode === 'string' && raw.pairingCode.trim()) ||
    (typeof raw.data?.pairingCode === 'string' && raw.data.pairingCode.trim()) ||
    (typeof raw.instance?.pairingCode === 'string' && raw.instance.pairingCode.trim()) ||
    null;
  return c || null;
}

/** QR ou pairing retornado por connect/create na Evolution (várias versões). */
export function extractConnectArtifactFromPayload(connectResponse) {
  if (!connectResponse || connectResponse.skippedDueToCooldown) {
    return { artifactType: null, artifact: null };
  }
  const pairing = pickPairingCodeFromPayload(connectResponse);
  if (pairing) {
    return { artifactType: 'pairing_code', artifact: pairing };
  }
  const qrRaw = extractQrPayload(connectResponse);
  if (qrRaw) {
    return { artifactType: 'qrcode', artifact: toQrDataUrl(qrRaw) };
  }
  return { artifactType: null, artifact: null };
}

export async function persistWhatsappConnectionArtifact(channel, artifactType, artifact) {
  if (!channel?.id || !artifactType || artifact == null) return channel;
  const str = String(artifact);
  const trimmed = str.length > MAX_WHATSAPP_ARTIFACT_LEN ? str.slice(0, MAX_WHATSAPP_ARTIFACT_LEN) : str;
  if (str.length > MAX_WHATSAPP_ARTIFACT_LEN) {
    console.warn('[WHATSAPP_ARTIFACT] truncated', { channelId: channel.id, len: str.length });
  }
  const cfg = mergeWhatsappConfig(channel.config, {
    artifactType,
    artifact: trimmed,
    artifactUpdatedAt: new Date().toISOString(),
  });
  const updated = await channelRepo.updateConnection(channel.id, channel.tenant_id, { config: cfg });
  return updated ?? channel;
}

async function clearStoredWhatsappArtifact(channel) {
  const cfg = mergeWhatsappConfig(channel.config, {
    artifact: null,
    artifactType: null,
    artifactUpdatedAt: new Date().toISOString(),
  });
  const updated = await channelRepo.updateConnection(channel.id, channel.tenant_id, { config: cfg });
  return updated ?? channel;
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
 * Ordem: external_id → slugify(instance) → nome padrão global (uma instância canônica).
 */
function getEvolutionInstanceName(channel) {
  const ext = channel?.external_id != null ? String(channel.external_id).trim() : '';
  if (ext) return ext;
  const type = String(channel?.type || '').toLowerCase();
  if (type === 'whatsapp') {
    const flow = getWhatsappFlow(channel?.config);
    if (flow.phase === WHATSAPP_PHASE.DRAFT) return null;
  }
  const fromInstance = slugifyInstance(channel?.instance);
  if (fromInstance) return fromInstance;
  return DEFAULT_EVOLUTION_INSTANCE_NAME;
}

/** Coleta nomes de instância a partir da resposta de fetchInstances (formatos variados da Evolution). */
export function collectInstanceNamesFromFetch(data) {
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
    // checkEvolutionHealth usa cache Redis + singleflight (evolutionInstancesCache)
    const data = await evolutionService.checkEvolutionHealth();
    return collectInstanceNamesFromFetch(data).has(instanceName);
  } catch {
    return false;
  }
}

/**
 * Indica se o nome de instância existe na Evolution (GET fetchInstances).
 * Usado ao associar canal a instância já criada manualmente na API.
 */
export async function evolutionInstanceExists(instanceName) {
  const n = String(instanceName || '').trim();
  if (!n) return false;
  return evolutionAlreadyHasInstance(n);
}

/**
 * Associa o canal a uma instância WhatsApp já existente na Evolution (POST /instance/create não é usado).
 * Fluxo manual: instância criada na API Evolution → usuário seleciona o nome → backend só persiste vínculo.
 */
export async function createWhatsAppInstance(channel) {
  const instanceName =
    String(channel?.external_id || '').trim() ||
    slugifyInstance(channel?.instance) ||
    DEFAULT_EVOLUTION_INSTANCE_NAME;

  if (!(await evolutionAlreadyHasInstance(instanceName))) {
    throw new Error(
      'Instância não encontrada na Evolution. Crie a instância manualmente na API e associe o canal.'
    );
  }

  const updatedChannel = await channelRepo.updateConnection(channel.id, channel.tenant_id, {
    external_id: instanceName,
    provider: 'evolution',
    status: mapEvolutionStatus('disconnected'),
    evolution_status: 'disconnected',
  });

  logger.instanceCreated(instanceName, channel.id);
  return {
    instanceName,
    createResponse: { associated: true, reason: 'existing_evolution_instance' },
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
    err.userMessage = 'Conclua o provisionamento da instância antes de conectar.';
    throw err;
  }

  const instanceName = ext;

  const flow = getWhatsappFlow(channel.config);
  const phaseBefore = deriveFlowPhase(channel);

  if (flow.lastConnectAt && !canAutoConnect(flow)) {
    console.log('[WHATSAPP_CONNECT] skipped cooldown', {
      channelId: channel.id,
      tenantId,
      phaseBefore,
      instance: instanceName,
    });
    return {
      instanceName,
      createResponse: null,
      connectResponse: { skippedDueToCooldown: true },
      channel,
    };
  }

  console.log('[WHATSAPP_CONNECT] start', {
    channelId: channel.id,
    tenantId,
    phaseBefore,
    instance: instanceName,
    endpoint: 'POST /instance/connect',
  });
  const connectResponse = await evolutionService.connectInstance(instanceName, { reset: false });

  const connectingDbStatus = mapEvolutionStatus('connecting');
  const cfg = mergeWhatsappConfig(channel.config, {
    phase: WHATSAPP_PHASE.AWAITING_CONNECTION,
    lastConnectAt: new Date().toISOString(),
  });

  let updatedChannel = await channelRepo.updateConnection(channel.id, tenantId, {
    external_id: instanceName,
    provider: 'evolution',
    status: connectingDbStatus,
    evolution_status: 'connecting',
    config: cfg,
  });
  updatedChannel = updatedChannel ?? channel;

  const extracted = extractConnectArtifactFromPayload(connectResponse);
  if (extracted.artifactType && extracted.artifact) {
    updatedChannel = await persistWhatsappConnectionArtifact(
      updatedChannel,
      extracted.artifactType,
      extracted.artifact
    );
  }

  console.log('[WHATSAPP_CONNECT] done', {
    channelId: channel.id,
    tenantId,
    phaseBefore,
    phaseAfter: deriveFlowPhase(updatedChannel),
    instance: instanceName,
  });

  return {
    instanceName,
    createResponse: null,
    connectResponse,
    channel: updatedChannel,
  };
}

/**
 * Obtém QR Code para o canal (instância já provisionada). Sem connect prévio — recovery fica no cliente HTTP.
 */
export async function getChannelQrCode(channel) {
  const instanceName = getEvolutionInstanceName(channel);
  if (!instanceName) {
    const err = new Error('Instance not created');
    err.code = 'INSTANCE_NOT_FOUND';
    err.userMessage = 'Conclua o provisionamento da instância antes de obter o QR Code.';
    throw err;
  }
  console.log('[WHATSAPP_ARTIFACT] getQRCode', { channelId: channel.id, instance: instanceName });
  return await evolutionService.getQRCode(instanceName);
}

/**
 * Artefato de conexão atual (QR ou pairing) + status público.
 */
export async function getChannelConnectionArtifact(channel) {
  const instance = getEvolutionInstanceName(channel);
  const tenantId = channel.tenant_id;
  const flow = getWhatsappFlow(channel.config);
  const phaseBefore = deriveFlowPhase(channel);

  console.log('[WHATSAPP_ARTIFACT] resolve', {
    channelId: channel.id,
    tenantId,
    instance,
    phaseBefore,
  });

  if (!instance) {
    return {
      status: 'inactive',
      artifactType: null,
      artifact: null,
      rawStatus: null,
      instance: null,
    };
  }

  try {
    const state = await evolutionService.getStatus(instance);
    const rawState = state?.state ?? state?.instance?.state ?? null;
    const rawLower = rawState != null ? String(rawState).trim().toLowerCase() : '';

    if (rawLower === 'open') {
      await clearStoredWhatsappArtifact(channel);
      console.log('[WHATSAPP_ARTIFACT] connected — cache limpo', {
        channelId: channel.id,
        tenantId,
        phaseBefore,
        phaseAfter: WHATSAPP_PHASE.CONNECTED,
      });
      return {
        status: 'connected',
        artifactType: null,
        artifact: null,
        rawStatus: rawState,
        instance,
      };
    }

    let qrRaw = null;
    try {
      qrRaw = await evolutionService.getQRCode(instance);
    } catch (e) {
      console.warn('[WHATSAPP_ARTIFACT] getQRCode falhou', {
        channelId: channel.id,
        tenantId,
        instance,
        message: e.message,
      });
    }

    const payload = extractQrPayload(qrRaw);
    if (payload) {
      const dataUrl = toQrDataUrl(payload);
      const updated = await persistWhatsappConnectionArtifact(channel, 'qrcode', dataUrl);
      console.log('[WHATSAPP_ARTIFACT] qrcode persistido', {
        channelId: channel.id,
        tenantId,
        phaseBefore,
        rawStatus: rawState,
      });
      return {
        status: 'awaiting_connection',
        artifactType: 'qrcode',
        artifact: dataUrl,
        rawStatus: rawState,
        instance,
        channel: updated,
      };
    }

    const pairing =
      qrRaw && typeof qrRaw === 'object' && typeof qrRaw.pairingCode === 'string'
        ? qrRaw.pairingCode.trim()
        : null;
    if (pairing) {
      const updated = await persistWhatsappConnectionArtifact(channel, 'pairing_code', pairing);
      console.log('[WHATSAPP_ARTIFACT] pairing persistido', {
        channelId: channel.id,
        tenantId,
        phaseBefore,
        rawStatus: rawState,
      });
      return {
        status: 'awaiting_connection',
        artifactType: 'pairing_code',
        artifact: pairing,
        rawStatus: rawState,
        instance,
        channel: updated,
      };
    }

    const useCached =
      flow.artifactType &&
      flow.artifact &&
      (rawLower === 'close' || rawLower === 'connecting' || rawLower === 'qr' || !rawLower);

    if (useCached) {
      console.log('[WHATSAPP_ARTIFACT] sem payload novo — devolvendo cache config', {
        channelId: channel.id,
        tenantId,
        phaseBefore,
        rawStatus: rawState,
      });
      return {
        status: 'awaiting_connection',
        artifactType: flow.artifactType,
        artifact: flow.artifact,
        rawStatus: rawState,
        instance,
        staleArtifact: true,
      };
    }

    return {
      status: publicSt === 'inactive' ? 'inactive' : 'awaiting_connection',
      artifactType: null,
      artifact: null,
      rawStatus: rawState,
      instance,
    };
  } catch (err) {
    const ax = err.response?.status;
    const code = err.code;
    const cached =
      flow.artifactType && flow.artifact
        ? { artifactType: flow.artifactType, artifact: flow.artifact }
        : null;
    const isNetwork = code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ETIMEDOUT';
    const isServer = typeof ax === 'number' && ax >= 500;

    console.error('[WHATSAPP_ARTIFACT] exceção', {
      channelId: channel.id,
      tenantId,
      phaseBefore,
      instance,
      httpStatus: ax,
      code,
      technical: err.message,
    });

    if (cached && (isNetwork || isServer)) {
      return {
        status: 'awaiting_connection',
        artifactType: cached.artifactType,
        artifact: cached.artifact,
        rawStatus: null,
        instance,
        staleArtifact: true,
        evolutionDegraded: true,
      };
    }

    if (ax === 404) {
      return {
        status: 'inactive',
        artifactType: null,
        artifact: null,
        rawStatus: null,
        instance,
      };
    }

    if (isNetwork) {
      return {
        status: 'inactive',
        artifactType: cached?.artifactType ?? null,
        artifact: cached?.artifact ?? null,
        rawStatus: null,
        instance,
        evolutionOffline: true,
      };
    }

    const definitiveClientError =
      typeof ax === 'number' && [400, 401, 403, 422].includes(ax);
    if (definitiveClientError) {
      return {
        status: 'error',
        artifactType: null,
        artifact: null,
        rawStatus: null,
        instance,
      };
    }

    return {
      status: 'awaiting_connection',
      artifactType: cached?.artifactType ?? null,
      artifact: cached?.artifact ?? null,
      rawStatus: null,
      instance,
      staleArtifact: Boolean(cached),
    };
  }
}

/**
 * Obtém status na Evolution e atualiza banco com status normalizado (connected/disconnected/connecting).
 * Nunca cria instância em resposta a 404 ou ausência na Evolution.
 */
function mapPublicWhatsappStatus(rawState, channel) {
  const rl = rawState != null ? String(rawState).trim().toLowerCase() : '';
  const hasExt = channel.external_id != null && String(channel.external_id).trim() !== '';

  if (rl === 'open') return 'connected';
  if (rl === 'connecting' || rl === 'qr') return 'awaiting_connection';
  if (rl === 'close') return hasExt ? 'awaiting_connection' : 'inactive';
  if (!rl || rl === 'undefined') return hasExt ? 'awaiting_connection' : 'inactive';
  return hasExt ? 'awaiting_connection' : 'inactive';
}

export async function getChannelStatus(channel) {
  const instanceName = getEvolutionInstanceName(channel);
  const tenantId = channel.tenant_id;

  if (!instanceName) {
    console.log('[WHATSAPP_STATUS] sem instance', {
      channelId: channel.id,
      tenantId,
      phaseBefore: deriveFlowPhase(channel),
    });
    return {
      normalizedStatus: 'unknown',
      publicStatus: 'inactive',
      state: null,
      channel,
    };
  }

  try {
    const phaseBefore = deriveFlowPhase(channel);
    const state = await evolutionService.getStatus(instanceName);
    const rawState = state?.state ?? state?.instance?.state ?? null;
    const rawLower = rawState != null ? String(rawState).trim().toLowerCase() : '';

    const normalizedStatus = normalizeEvolutionState(rawState);
    const dbStatus = mapEvolutionStatus(rawState);
    console.log('[WHATSAPP_STATUS]', {
      channelId: channel.id,
      tenantId,
      phaseBefore,
      instance: instanceName,
      endpoint: 'GET /instance/connectionState',
      raw: rawState,
      dbStatus,
    });

    const previousStatus = channel.status ?? null;
    if (dbStatus !== previousStatus) {
      logger.statusChange(instanceName, channel.id, previousStatus, normalizedStatus);
    }

    let configUpdate = undefined;
    if (String(channel.type || '').toLowerCase() === 'whatsapp' && rawLower === 'open') {
      configUpdate = mergeWhatsappConfig(channel.config, {
        phase: WHATSAPP_PHASE.CONNECTED,
        artifact: null,
        artifactType: null,
        artifactUpdatedAt: new Date().toISOString(),
      });
    }

    const updatedChannel = await channelRepo.updateConnection(channel.id, channel.tenant_id, {
      status: dbStatus,
      evolution_status: toEvolutionStatusColumn(rawState),
      ...(dbStatus === 'active' ? { connected_at: new Date(), last_error: null } : {}),
      ...(configUpdate !== undefined ? { config: configUpdate } : {}),
    });

    const rowForPublic = updatedChannel ?? channel;
    const publicStatus = mapPublicWhatsappStatus(rawState, rowForPublic);

    console.log('[WHATSAPP_STATUS] mapped', {
      channelId: channel.id,
      tenantId,
      phaseBefore,
      phaseAfter: deriveFlowPhase(rowForPublic),
      publicStatus,
      raw: rawState,
    });

    return {
      normalizedStatus,
      publicStatus,
      state,
      channel: rowForPublic,
    };
  } catch (err) {
    const code = err.code;
    const axStatus = err.response?.status;
    const phaseBefore = deriveFlowPhase(channel);
    console.error('[WHATSAPP_STATUS] erro', {
      channelId: channel.id,
      tenantId,
      phaseBefore,
      technical: err.message,
      httpStatus: axStatus,
      code,
    });

    if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ETIMEDOUT') {
      const hasExt = channel.external_id != null && String(channel.external_id).trim() !== '';
      return {
        normalizedStatus: 'unknown',
        publicStatus: hasExt ? 'awaiting_connection' : 'inactive',
        state: null,
        channel,
        evolutionOffline: true,
        error: 'Evolution API indisponível. Verifique se o serviço está em execução.',
      };
    }

    if (axStatus === 404) {
      console.warn('[WHATSAPP_STATUS] instance 404', { channelId: channel.id, tenantId, phaseBefore });
      return {
        normalizedStatus: 'unknown',
        publicStatus: 'inactive',
        state: null,
        channel,
        instanceNotFound: true,
        code: 'INSTANCE_NOT_FOUND',
        message: 'Instance not created',
      };
    }

    const hasExt = channel.external_id != null && String(channel.external_id).trim() !== '';
    return {
      normalizedStatus: 'unknown',
      publicStatus: hasExt ? 'awaiting_connection' : 'inactive',
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
