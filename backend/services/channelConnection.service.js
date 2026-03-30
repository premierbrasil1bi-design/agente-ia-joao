/**
 * Serviço de conexão de canais WhatsApp via Evolution API.
 * Orquestra conexão, QR, status e desconexão.
 * Associação à Evolution: instância deve existir previamente (createWhatsAppInstance só persiste vínculo).
 */

import * as evolutionService from './evolutionService.js';
import * as channelRepo from '../repositories/channel.repository.js';
import { normalizeEvolutionState } from '../utils/evolutionState.js';
import { dualStatusFromEvolutionRaw } from '../utils/mapConnectionLifecycle.js';
import {
  CONNECTION,
  transitionEvolutionChannelConnection,
} from './channelEvolutionState.service.js';
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
import * as wahaService from './wahaService.js';

const { resolveWahaSessionName } = wahaService;

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

/**
 * Extrai mapa instanceName → estado bruto (quando presente em fetchInstances).
 */
export function extractInstanceStatesFromFetch(data) {
  /** @type {Map<string, string>} */
  const map = new Map();
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

    const name =
      (typeof obj.instanceName === 'string' && obj.instanceName.trim()) ||
      (typeof obj.name === 'string' && obj.name.trim()) ||
      (obj.instance && typeof obj.instance.instanceName === 'string' && obj.instance.instanceName.trim()) ||
      (obj.instance && typeof obj.instance.name === 'string' && obj.instance.name.trim()) ||
      null;

    const state =
      obj.state ??
      obj.connectionStatus?.state ??
      obj.instance?.state ??
      (obj.instance && typeof obj.instance === 'object' ? obj.instance.connectionStatus?.state : null);

    if (name && state != null && String(state).trim() !== '') {
      map.set(String(name).trim(), String(state).trim());
    }

    for (const v of Object.values(obj)) {
      if (v && typeof v === 'object') visit(v, depth + 1);
    }
  }

  visit(data, 0);
  return map;
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

  const tr = await transitionEvolutionChannelConnection({
    channelId: channel.id,
    tenantId: channel.tenant_id,
    channelRow: channel,
    nextConnectionStatus: CONNECTION.DISCONNECTED,
    evolutionRaw: 'disconnected',
    reason: 'user: associar canal a instância Evolution existente',
    source: 'user',
    patch: {
      external_id: instanceName,
      provider: 'evolution',
    },
  });
  const updatedChannel = tr.channel ?? channel;

  logger.instanceCreated(instanceName, channel.id);
  return {
    instanceName,
    createResponse: { associated: true, reason: 'existing_evolution_instance' },
    channel: updatedChannel,
  };
}

function isWahaChannel(channel) {
  if (String(channel?.provider || '').toLowerCase() === 'waha') return true;
  const t = channel?.provider_config?.type;
  return t != null && String(t).trim().toLowerCase() === 'waha';
}

function mapWahaSessionStatusToConnection(wahaStatus, sessionPayload) {
  const s = String(wahaStatus || '').toUpperCase();
  if (s === 'WORKING' && sessionPayload?.me) return CONNECTION.CONNECTED;
  if (s === 'WORKING') return CONNECTION.CONNECTING;
  if (s === 'SCAN_QR_CODE' || s === 'STARTING') return CONNECTION.CONNECTING;
  if (s === 'FAILED') return CONNECTION.ERROR;
  if (s === 'STOPPED') return CONNECTION.DISCONNECTED;
  return CONNECTION.CONNECTING;
}

/**
 * CONNECT (WAHA): cria/inicia sessão no WAHA — nome = external_id do canal.
 */
async function connectWhatsAppChannelWaha(channel) {
  const tenantId = channel.tenant_id;
  const ext = resolveWahaSessionName(channel);

  const flow = getWhatsappFlow(channel.config);
  const phaseBefore = deriveFlowPhase(channel);
  if (flow.lastConnectAt && !canAutoConnect(flow)) {
    return {
      instanceName: ext,
      createResponse: null,
      connectResponse: { skippedDueToCooldown: true },
      channel,
    };
  }

  console.log('[WHATSAPP_CONNECT][WAHA] start', { channelId: channel.id, tenantId, phaseBefore, session: ext });
  const created = await wahaService.createSession(ext);
  if (!created.ok) {
    throw new Error(created.error || 'Falha ao criar sessão no WAHA.');
  }

  // Configura webhook para recebimento + status automático.
  // Se falhar, não deve derrubar a rota: o endpoint /status segue como fallback.
  try {
    const wh = await wahaService.setWebhook(ext);
    if (!wh.ok) {
      console.warn('[WAHA] setWebhook falhou:', wh.error || 'unknown');
    }
  } catch (e) {
    console.warn('[WAHA] setWebhook exception:', e?.message || e);
  }

  const cfg = mergeWhatsappConfig(channel.config, {
    phase: WHATSAPP_PHASE.AWAITING_CONNECTION,
    lastConnectAt: new Date().toISOString(),
  });

  const trConnect = await transitionEvolutionChannelConnection({
    channelId: channel.id,
    tenantId,
    channelRow: channel,
    nextConnectionStatus: CONNECTION.CONNECTING,
    evolutionRaw: 'waha_connect',
    reason: 'user: WAHA createSession/start',
    source: 'user',
    patch: {
      external_id: ext,
      provider: 'waha',
      config: cfg,
    },
  });
  let updatedChannel = trConnect.channel ?? channel;

  console.log('[WHATSAPP_CONNECT][WAHA] done', {
    channelId: channel.id,
    tenantId,
    phaseAfter: deriveFlowPhase(updatedChannel),
    session: ext,
  });

  return {
    instanceName: ext,
    createResponse: created.data,
    connectResponse: created.data,
    channel: updatedChannel,
  };
}

async function getChannelQrCodeWaha(channel) {
  const instanceName = resolveWahaSessionName(channel);
  const qr = await wahaService.getQrCode(instanceName);
  if (!qr.ok) {
    throw new Error(qr.error || 'WAHA: falha ao obter QR.');
  }
  const raw = qr.raw;
  if (raw && typeof raw === 'object' && typeof raw.data === 'string' && !extractQrPayload(raw)) {
    return { data: { base64: raw.data }, mimetype: raw.mimetype };
  }
  return raw;
}

async function getChannelStatusWaha(channel) {
  const instanceName = resolveWahaSessionName(channel);
  const tenantId = channel.tenant_id;
  const st = await wahaService.getSessionStatus(instanceName);
  if (!st.ok || !st.data) {
    return {
      normalizedStatus: 'unknown',
      publicStatus: 'inactive',
      state: null,
      channel,
      evolutionOffline: true,
      error: st.error || 'WAHA indisponível',
    };
  }

  const wahaStatus = st.data.status;
  const nextConn = mapWahaSessionStatusToConnection(wahaStatus, st.data);
  let configUpdate;
  if (String(wahaStatus || '').toUpperCase() === 'WORKING' && st.data.me) {
    configUpdate = mergeWhatsappConfig(channel.config, {
      phase: WHATSAPP_PHASE.CONNECTED,
      artifact: null,
      artifactType: null,
      artifactUpdatedAt: new Date().toISOString(),
    });
  }

  const trPoll = await transitionEvolutionChannelConnection({
    channelId: channel.id,
    tenantId: channel.tenant_id,
    channelRow: channel,
    nextConnectionStatus: nextConn,
    evolutionRaw: String(wahaStatus),
    reason: 'poll: WAHA GET /api/sessions/{name}',
    source: 'poll',
    trustRemoteState: true,
    patch: configUpdate !== undefined ? { config: configUpdate } : {},
  });
  const updated = trPoll.channel ?? channel;
  const connected = String(wahaStatus || '').toUpperCase() === 'WORKING' && Boolean(st.data.me);
  const publicStatus = connected ? 'connected' : nextConn === CONNECTION.CONNECTING ? 'awaiting_connection' : 'inactive';

  const upper = String(wahaStatus || '').toUpperCase();
  let normalizedStatus = 'unknown';
  if (connected) normalizedStatus = 'connected';
  else if (upper === 'FAILED' || nextConn === CONNECTION.ERROR) normalizedStatus = 'error';
  else if (upper === 'STOPPED') normalizedStatus = 'disconnected';
  else if (upper === 'SCAN_QR_CODE' || upper === 'STARTING' || nextConn === CONNECTION.CONNECTING) {
    normalizedStatus = 'connecting';
  }

  return {
    normalizedStatus,
    publicStatus,
    state: { state: wahaStatus, waha: st.data },
    channel: updated,
  };
}

async function disconnectChannelWaha(channel) {
  // WAHA Core: sessão única "default" pode ser compartilhada.
  // Não derrubar a sessão remota ao desconectar um canal local.
  await transitionEvolutionChannelConnection({
    channelId: channel.id,
    tenantId: channel.tenant_id,
    channelRow: channel,
    nextConnectionStatus: CONNECTION.DISCONNECTED,
    evolutionRaw: 'waha_disconnected',
    reason: 'user: disconnect WAHA (single-session: não encerra sessão remota)',
    source: 'user',
    patch: {
      connected_at: null,
    },
  });
}

/** Artefato de conexão (WAHA): espelha fluxo Evolution (QR / conectado). */
async function getChannelConnectionArtifactWaha(channel) {
  const instance = resolveWahaSessionName(channel);
  const tenantId = channel.tenant_id;

  const st = await wahaService.getSessionStatus(instance);
  if (!st.ok || !st.data) {
    return {
      status: 'inactive',
      artifactType: null,
      artifact: null,
      rawStatus: null,
      instance,
      evolutionOffline: true,
    };
  }

  const wahaStatus = st.data.status;
  const upper = String(wahaStatus || '').toUpperCase();
  if (upper === 'WORKING' && st.data.me) {
    await clearStoredWhatsappArtifact(channel);
    const cfgOpen = mergeWhatsappConfig(channel.config, {
      phase: WHATSAPP_PHASE.CONNECTED,
      artifact: null,
      artifactType: null,
      artifactUpdatedAt: new Date().toISOString(),
    });
    await transitionEvolutionChannelConnection({
      channelId: channel.id,
      tenantId,
      channelRow: channel,
      nextConnectionStatus: CONNECTION.CONNECTED,
      evolutionRaw: String(wahaStatus),
      reason: 'poll WAHA: WORKING+me',
      source: 'poll',
      trustRemoteState: true,
      patch: { config: cfgOpen },
    });
    return {
      status: 'connected',
      artifactType: null,
      artifact: null,
      rawStatus: wahaStatus,
      instance,
    };
  }

  let qrRaw = null;
  try {
    qrRaw = await getChannelQrCodeWaha(channel);
  } catch (e) {
    console.warn('[WHATSAPP_ARTIFACT][WAHA] getQRCode falhou', e.message);
  }
  const payload = extractQrPayload(qrRaw);
  if (payload) {
    const dataUrl = toQrDataUrl(payload);
    const updated = await persistWhatsappConnectionArtifact(channel, 'qrcode', dataUrl);
    return {
      status: 'awaiting_connection',
      artifactType: 'qrcode',
      artifact: dataUrl,
      rawStatus: wahaStatus,
      instance,
      channel: updated,
    };
  }

  return {
    status: 'awaiting_connection',
    artifactType: null,
    artifact: null,
    rawStatus: wahaStatus,
    instance,
  };
}

/**
 * POST connect: exige external_id já persistido (instância criada manualmente / fluxo explícito).
 * Não cria instância automaticamente.
 */
export async function connectWhatsAppChannel(channel) {
  if (isWahaChannel(channel)) {
    return connectWhatsAppChannelWaha(channel);
  }

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

  const cfg = mergeWhatsappConfig(channel.config, {
    phase: WHATSAPP_PHASE.AWAITING_CONNECTION,
    lastConnectAt: new Date().toISOString(),
  });

  const trConnect = await transitionEvolutionChannelConnection({
    channelId: channel.id,
    tenantId,
    channelRow: channel,
    nextConnectionStatus: CONNECTION.CONNECTING,
    evolutionRaw: 'connecting',
    reason: 'user: POST connect (instance/connect)',
    source: 'user',
    patch: {
      external_id: instanceName,
      provider: 'evolution',
      config: cfg,
    },
  });
  let updatedChannel = trConnect.channel ?? channel;

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
  if (isWahaChannel(channel)) {
    return getChannelQrCodeWaha(channel);
  }

  const instanceName = getEvolutionInstanceName(channel);
  if (!instanceName) {
    const err = new Error('Instance not created');
    err.code = 'INSTANCE_NOT_FOUND';
    err.userMessage = 'Conclua o provisionamento da instância antes de obter o QR Code.';
    throw err;
  }
  console.log('[EVOLUTION] getQRCode channelId=%s instance=%s', channel.id, instanceName);
  const qr = await evolutionService.getQRCode(instanceName);
  try {
    await transitionEvolutionChannelConnection({
      channelId: channel.id,
      tenantId: channel.tenant_id,
      channelRow: channel,
      nextConnectionStatus: CONNECTION.CONNECTING,
      evolutionRaw: 'connecting',
      reason: 'user: obter QR Code',
      source: 'user',
    });
  } catch (e) {
    console.warn('[EVOLUTION] getQRCode persist connecting failed:', e.message);
  }
  return qr;
}

/**
 * Artefato de conexão atual (QR ou pairing) + status público.
 */
export async function getChannelConnectionArtifact(channel) {
  if (isWahaChannel(channel)) {
    return getChannelConnectionArtifactWaha(channel);
  }

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
      const cfgOpen = mergeWhatsappConfig(channel.config, {
        phase: WHATSAPP_PHASE.CONNECTED,
        artifact: null,
        artifactType: null,
        artifactUpdatedAt: new Date().toISOString(),
      });
      await transitionEvolutionChannelConnection({
        channelId: channel.id,
        tenantId,
        channelRow: channel,
        nextConnectionStatus: CONNECTION.CONNECTED,
        evolutionRaw: rawState,
        reason: 'poll: artefato de conexão — estado open',
        source: 'poll',
        trustRemoteState: true,
        patch: { config: cfgOpen },
      });
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

    const publicSt = mapPublicWhatsappStatus(rawState, channel);
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
      await transitionEvolutionChannelConnection({
        channelId: channel.id,
        tenantId,
        channelRow: channel,
        nextConnectionStatus: CONNECTION.ERROR,
        evolutionRaw: `http_${ax}`,
        reason: `poll: artefato Evolution HTTP ${ax} (erro cliente confirmado)`,
        source: 'poll',
        trustRemoteState: true,
        patch: { last_error: `Evolution retornou HTTP ${ax} ao obter artefato.` },
      });
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
  if (isWahaChannel(channel)) {
    return getChannelStatusWaha(channel);
  }

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
    const { connection_status, status: legacyPreview } = dualStatusFromEvolutionRaw(rawState);
    console.log('[EVOLUTION] channel status poll channelId=%s instance=%s raw=%s connection_status=%s', channel.id, instanceName, rawState, connection_status);

    const previousStatus = channel.status ?? null;
    if (legacyPreview !== previousStatus) {
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

    const trPoll = await transitionEvolutionChannelConnection({
      channelId: channel.id,
      tenantId: channel.tenant_id,
      channelRow: channel,
      nextConnectionStatus: connection_status,
      evolutionRaw: rawState,
      reason: 'poll: GET connectionState (status do canal)',
      source: 'poll',
      trustRemoteState: true,
      patch: configUpdate !== undefined ? { config: configUpdate } : {},
    });
    const updatedChannel = trPoll.channel ?? channel;

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
      await transitionEvolutionChannelConnection({
        channelId: channel.id,
        tenantId,
        channelRow: channel,
        nextConnectionStatus: CONNECTION.ERROR,
        evolutionRaw: 'http_404',
        reason: 'poll: connectionState HTTP 404 (instância inexistente)',
        source: 'poll',
        trustRemoteState: true,
        patch: { last_error: 'Evolution retornou 404 para connectionState desta instância.' },
      });
      const refreshed = await channelRepo.findById(channel.id, tenantId);
      return {
        normalizedStatus: 'unknown',
        publicStatus: 'inactive',
        state: null,
        channel: refreshed ?? channel,
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
  if (isWahaChannel(channel)) {
    return disconnectChannelWaha(channel);
  }

  const ext = channel?.external_id != null ? String(channel.external_id).trim() : '';

  if (!ext) {
    await transitionEvolutionChannelConnection({
      channelId: channel.id,
      tenantId: channel.tenant_id,
      channelRow: channel,
      nextConnectionStatus: CONNECTION.DISCONNECTED,
      evolutionRaw: 'disconnected',
      reason: 'user: disconnect sem external_id (só persistência local)',
      source: 'user',
    });
    return;
  }

  try {
    await evolutionService.disconnectInstance(ext);
  } catch (err) {
    console.error('[EVOLUTION] disconnectInstance error:', err.message);
  }

  await transitionEvolutionChannelConnection({
    channelId: channel.id,
    tenantId: channel.tenant_id,
    channelRow: channel,
    nextConnectionStatus: CONNECTION.DISCONNECTED,
    evolutionRaw: 'disconnected',
    reason: 'user: disconnect + limpar vínculo Evolution',
    source: 'user',
    patch: {
      external_id: null,
      connected_at: null,
    },
  });
  logger.statusChange(ext, channel.id, channel.status, 'disconnected');
}
