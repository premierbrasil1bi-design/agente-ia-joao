/**
 * Provisionamento automático de instância Evolution para canal WhatsApp (SaaS).
 * Isola POST /instance/create e normalização — rotas só orquestram.
 * Idempotente: lock por canal, skips explícitos, retry de create só em fases permitidas.
 */

import * as channelRepo from '../repositories/channel.repository.js';
import * as evolutionService from './evolutionService.js';
import { collectInstanceNamesFromFetch } from './channelConnection.service.js';
import { isEvolutionTransientError } from './evolutionHttp.client.js';
import {
  WHATSAPP_PHASE,
  mergeWhatsappConfig,
  getWhatsappFlow,
  deriveFlowPhase,
} from '../utils/whatsappChannelFlow.js';
import {
  CONNECTION,
  transitionEvolutionChannelConnection,
} from './channelEvolutionState.service.js';

const USER_ERR_PROVISION = 'Não foi possível provisionar a instância do WhatsApp.';
const ERR_INSTANCE_NOT_LISTED =
  'Instância não localizada na Evolution. Só é possível novo provisionamento automático quando o canal está em estado de erro; contate o suporte se precisar.';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** @type {Map<string, Promise<object>>} */
const provisionLocks = new Map();

function lockKey(tenantId, channelId) {
  return `${tenantId}:${channelId}`;
}

/** Nome estável e único por tenant+canal (Evolution aceita [a-zA-Z0-9_-]). */
export function generateEvolutionInstanceName(tenantId, channelId) {
  const tid = String(tenantId || '').replace(/-/g, '').slice(0, 10);
  const cid = String(channelId || '').replace(/-/g, '');
  const base = `wa_${tid}_${cid}`.replace(/[^a-zA-Z0-9_]/g, '_');
  return base.slice(0, 72);
}

function pickExternalIdFromCreate(body, fallbackName) {
  if (body == null || typeof body !== 'object') return fallbackName;
  const inst = body.instance ?? body.data?.instance;
  if (inst && typeof inst === 'object') {
    return (
      inst.instanceName ||
      inst.instanceId ||
      inst.id ||
      inst.name ||
      fallbackName
    );
  }
  return fallbackName;
}

async function evolutionHasInstanceName(name) {
  try {
    const data = await evolutionService.checkEvolutionHealth();
    return collectInstanceNamesFromFetch(data).has(name);
  } catch {
    return false;
  }
}

async function tryCreateWithOptionalRetry(instanceName) {
  try {
    return await evolutionService.createInstance(instanceName);
  } catch (e1) {
    if (isEvolutionTransientError(e1)) {
      await sleep(800);
      return await evolutionService.createInstance(instanceName);
    }
    throw e1;
  }
}

/**
 * Chamadas concorrentes ao mesmo canal aguardam a mesma Promise (idempotência in-process).
 * @param {string} channelId
 * @param {string} tenantId
 * @returns {Promise<{ ok: boolean, channel?: object, skipped?: boolean, reason?: string, error?: string, technical?: string }>}
 */
export async function provisionWhatsAppInstance(channelId, tenantId) {
  const key = lockKey(tenantId, channelId);
  const existing = provisionLocks.get(key);
  if (existing) {
    console.log('[WHATSAPP_PROVISION] join in-flight', { channelId, tenantId });
    return existing;
  }

  const run = (async () => {
    try {
      return await runProvisionOnce(channelId, tenantId);
    } finally {
      provisionLocks.delete(key);
    }
  })();

  provisionLocks.set(key, run);
  return run;
}

async function runProvisionOnce(channelId, tenantId) {
  const channel = await channelRepo.findById(channelId, tenantId);
  if (!channel) {
    return { ok: false, error: 'Canal não encontrado.', technical: 'CHANNEL_NOT_FOUND' };
  }

  if (String(channel.type || '').toLowerCase() !== 'whatsapp') {
    return { ok: false, error: 'Provisionamento só se aplica a canais WhatsApp.', technical: 'NOT_WHATSAPP' };
  }

  const ext = channel.external_id != null ? String(channel.external_id).trim() : '';
  const extListed = ext ? await evolutionHasInstanceName(ext) : false;
  const flow = getWhatsappFlow(channel.config);
  const persistedPhase = flow.phase && Object.values(WHATSAPP_PHASE).includes(flow.phase) ? flow.phase : null;
  const derivedPhase = deriveFlowPhase(channel);

  const logBase = { channelId, tenantId, persistedPhase, derivedPhase };

  if (derivedPhase === WHATSAPP_PHASE.CONNECTED) {
    console.log('[WHATSAPP_PROVISION] skip already_connected', logBase);
    return { ok: true, channel, skipped: true, reason: 'already_connected' };
  }

  if (ext && extListed) {
    console.log('[WHATSAPP_PROVISION] skip instance already on Evolution', { ...logBase, instance: ext });
    const cfg = mergeWhatsappConfig(channel.config, {
      phase: WHATSAPP_PHASE.AWAITING_CONNECTION,
      provisioningStartedAt: null,
    });
    const updated = await channelRepo.updateConnection(channelId, tenantId, {
      config: cfg,
      provider: 'evolution',
      external_id: ext,
      instance: channel.instance || ext,
      last_error: null,
    });
    return { ok: true, channel: updated, skipped: true, reason: 'already_provisioned' };
  }

  if (
    ext &&
    !extListed &&
    persistedPhase !== WHATSAPP_PHASE.ERROR &&
    persistedPhase !== WHATSAPP_PHASE.DRAFT
  ) {
    console.warn('[WHATSAPP_PROVISION] blocked — ext not listed; retry automático só em error/draft', logBase);
    return { ok: false, error: ERR_INSTANCE_NOT_LISTED, technical: 'EVOLUTION_INSTANCE_NOT_LISTED' };
  }

  const phaseBefore = persistedPhase ?? derivedPhase;
  const startedAt = new Date().toISOString();
  const cfgProvisioning = mergeWhatsappConfig(channel.config, {
    phase: WHATSAPP_PHASE.PROVISIONING,
    userMessage: null,
    provisioningStartedAt: startedAt,
  });
  await channelRepo.updateConnection(channelId, tenantId, {
    config: cfgProvisioning,
    last_error: null,
  });

  const instanceName =
    (channel.instance != null && String(channel.instance).trim() !== ''
      ? String(channel.instance).trim().replace(/\s+/g, '-')
      : null) || generateEvolutionInstanceName(tenantId, channelId);

  console.log('[WHATSAPP_PROVISION] start create', {
    ...logBase,
    phaseBefore,
    phaseNew: WHATSAPP_PHASE.PROVISIONING,
    instance: instanceName,
    endpoint: 'POST /instance/create',
  });

  let createBody;
  try {
    createBody = await tryCreateWithOptionalRetry(instanceName);
  } catch (err) {
    const st = err.response?.status;
    const technical =
      (typeof err.response?.data === 'object' && err.response?.data?.message) ||
      err.message ||
      String(err);

    if (st === 409 || /already|exist|in use/i.test(technical)) {
      console.log('[WHATSAPP_PROVISION] 409/already exists — associando', { channelId, instance: instanceName });
      if (await evolutionHasInstanceName(instanceName)) {
        createBody = { instance: { instanceName } };
      } else {
        const cfgErr = mergeWhatsappConfig(channel.config, {
          phase: WHATSAPP_PHASE.ERROR,
          userMessage: USER_ERR_PROVISION,
          provisioningStartedAt: null,
        });
        await transitionEvolutionChannelConnection({
          channelId,
          tenantId,
          channelRow: channel,
          nextConnectionStatus: CONNECTION.ERROR,
          evolutionRaw: 'provision_failed',
          reason: 'provision: 409/conflito mas instância não listável na Evolution',
          source: 'provision',
          patch: { config: cfgErr, last_error: USER_ERR_PROVISION },
        });
        console.error('[WHATSAPP_PROVISION] fail 409 not listable', {
          channelId,
          tenantId,
          phaseBefore,
          phaseNew: WHATSAPP_PHASE.ERROR,
          technical,
        });
        return { ok: false, error: USER_ERR_PROVISION, technical };
      }
    } else {
      const cfgErr = mergeWhatsappConfig(channel.config, {
        phase: WHATSAPP_PHASE.ERROR,
        userMessage: USER_ERR_PROVISION,
        provisioningStartedAt: null,
      });
      await transitionEvolutionChannelConnection({
        channelId,
        tenantId,
        channelRow: channel,
        nextConnectionStatus: CONNECTION.ERROR,
        evolutionRaw: 'provision_failed',
        reason: 'provision: falha ao criar instância na Evolution',
        source: 'provision',
        patch: { config: cfgErr, last_error: USER_ERR_PROVISION },
      });
      console.error('[WHATSAPP_PROVISION] fail', {
        channelId,
        tenantId,
        instance: instanceName,
        phaseBefore,
        phaseNew: WHATSAPP_PHASE.ERROR,
        technical,
      });
      return { ok: false, error: USER_ERR_PROVISION, technical };
    }
  }

  const externalId = String(pickExternalIdFromCreate(createBody, instanceName)).trim();
  const cfgOk = mergeWhatsappConfig(channel.config, {
    phase: WHATSAPP_PHASE.AWAITING_CONNECTION,
    userMessage: null,
    provisionedAt: new Date().toISOString(),
    provisioningStartedAt: null,
  });

  const trOk = await transitionEvolutionChannelConnection({
    channelId,
    tenantId,
    channelRow: channel,
    nextConnectionStatus: CONNECTION.CONNECTING,
    evolutionRaw: 'close',
    reason: 'provision: instância criada — aguardando conexão (QR/pairing)',
    source: 'provision',
    patch: {
      config: cfgOk,
      provider: 'evolution',
      external_id: externalId,
      instance: externalId,
      last_error: null,
    },
  });
  const updated = trOk.channel ?? (await channelRepo.findById(channelId, tenantId));

  try {
    await evolutionService.invalidateEvolutionInstancesCache();
  } catch {
    /* opcional */
  }

  console.log('[WHATSAPP_PROVISION] ok', {
    channelId,
    tenantId,
    instance: externalId,
    phaseBefore,
    phaseNew: WHATSAPP_PHASE.AWAITING_CONNECTION,
  });
  return { ok: true, channel: updated };
}
