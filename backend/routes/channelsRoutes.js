/**
 * Rotas CRUD de canais – Client App (app.omnia1biai.com.br).
 * Protegidas por agentAuth (JWT do Client App); req.user e req.tenantId disponíveis.
 */

import { Router } from 'express';
import { agentAuth } from '../middleware/agentAuth.js';
import * as channelRepo from '../repositories/channel.repository.js';
import { requireActiveTenant } from '../middleware/requireActiveTenant.js';
import { sendBadRequest, sendNotFound } from '../utils/errorResponses.js';
import { pool } from '../db/pool.js';
import * as channelConnectionService from '../services/channelConnection.service.js';
import * as evolutionGateway from '../controllers/evolutionGateway.controller.js';
import { getProviderForChannel } from '../providers/index.js';
import {
  deriveFlowPhase,
  nextActionForChannel,
  WHATSAPP_PHASE,
  mergeWhatsappConfig,
} from '../utils/whatsappChannelFlow.js';
import { invalidateTenantChannels } from '../utils/channelCache.js';
import { resolveSessionName } from '../utils/resolveSessionName.js';
import { emitChannelSocketEvent } from '../utils/channelRealtime.js';
import * as channelOrchestrator from '../services/channelOrchestrator.js';
import {
  CONNECTION,
  transitionEvolutionChannelConnection,
} from '../services/channelEvolutionState.service.js';
import { ProviderAccessError, assertProviderAllowedForTenant } from '../services/providerAccess.service.js';
import {
  ConnectedChannelProviderChangeError,
  isChannelConnectedBlockingProviderChange,
} from '../services/channelProviderChangeGuard.service.js';
import { normalizeProviderId } from '../config/providersByPlan.js';
import {
  sendConnectedChannelProviderChangeBlocked,
  sendProviderAccessForbidden,
} from '../utils/providerAccessHttp.js';
import { provisionWithFallback } from '../services/channelProvisioning.service.js';
import { checkChannelHealth } from '../services/channelHealth.service.js';
import { getProvisioningQueue } from '../queues/provisioning.queue.js';
import { log } from '../utils/logger.js';
import { canConnectChannel } from '../services/tenantLimits.service.js';
import { sendTenantPlanLimit } from '../utils/tenantPlanLimitHttp.js';
import {
  assertCanCreateChannel,
  TenantPlanLimitBlockedError,
} from '../services/tenantLimitsGuard.js';

const router = Router();

router.use(agentAuth);

async function provisionInstanceWithProvider(channel, requestId = null) {
  if (!channel) {
    const err = new Error('Canal não encontrado.');
    err.httpStatus = 404;
    throw err;
  }
  await assertProviderAllowedForTenant({
    tenantId: channel.tenant_id,
    provider: channel.provider,
    channelId: channel.id,
    action: 'provision_instance',
    requestId,
  });
  const provider = getProviderForChannel(channel);
  const result = await provider.provisionInstance(channel);
  const providerName = String(channel.provider || '').toLowerCase().trim();
  return { result, providerName };
}

async function autoProvisionChannel(channelRow) {
  const provider = String(channelRow?.provider || '').toLowerCase().trim();
  if (!provider || !['waha', 'evolution'].includes(provider)) {
    return { skipped: true, provider: provider || null, reason: 'provider_not_supported' };
  }
  const queue = getProvisioningQueue();
  let result;
  try {
    result = await provisionWithFallback(channelRow);
    if (!result?.success) {
      result = { ...(result || {}), success: false, fallback: true };
      await queue.add(
        'retry-provision',
        { channel: channelRow },
        {
          jobId: `retry-${channelRow.id}`,
          removeOnComplete: true,
          removeOnFail: false,
        },
      );
      log.info({
        event: 'PROVISIONING_ENQUEUED',
        context: 'route',
        tenantId: channelRow?.tenant_id ?? null,
        channelId: channelRow?.id ?? null,
      });
    }
  } catch (error) {
    if (error instanceof ProviderAccessError) {
      log.warn({
        event: 'AUTO_PROVISION_PROVIDER_BLOCKED',
        context: 'route',
        tenantId: channelRow?.tenant_id ?? null,
        channelId: channelRow?.id ?? null,
        provider,
        requestId: null,
      });
      return { success: false, skipped: true, provider: provider || null, reason: 'provider_not_allowed' };
    }
    log.error({
      event: 'PROVISION_FAIL_OPEN',
      context: 'route',
      tenantId: channelRow?.tenant_id ?? null,
      channelId: channelRow?.id ?? null,
      provider,
      error: error?.message || String(error),
      stack: error?.stack,
    });
    result = { success: false, fallback: true };
    await queue.add(
      'retry-provision',
      { channel: channelRow },
      {
        jobId: `retry-${channelRow.id}`,
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
    log.info({
      event: 'PROVISIONING_ENQUEUED',
      context: 'route',
      tenantId: channelRow?.tenant_id ?? null,
      channelId: channelRow?.id ?? null,
    });
  }
  const isHealthy = await checkChannelHealth(channelRow);
  log.info({
    event: 'CHANNEL_HEALTH_CHECKED',
    context: 'route',
    tenantId: channelRow?.tenant_id ?? null,
    channelId: channelRow?.id ?? null,
    status: isHealthy ? 'healthy' : 'unhealthy',
  });
  return { ...result, provider, isHealthy };
}

/**
 * GET /api/channels/evolution-instances
 * Proxy de GET /instance/fetchInstances — lista instâncias já criadas na Evolution (seleção no Client App).
 * Deve ficar antes de GET /:id para não capturar "evolution-instances" como id.
 */
router.get('/evolution-instances', requireActiveTenant, evolutionGateway.listInstances);

/**
 * Campo `status` no JSON do Client App (UX). A verdade no banco é `connection_status`;
 * `status` (active/inactive) só entra como fallback legado se `connection_status` vazio ou não mapeado.
 */
function evolutionUiStatus(ch) {
  const cs = String(ch.connection_status || '').toLowerCase();
  if (cs === 'connecting') return 'connecting';
  if (cs === 'connected') return 'connected';
  if (cs === 'error') return 'error';
  if (cs === 'disconnected') {
    const ext = ch.external_id != null ? String(ch.external_id).trim() : '';
    if (!ext) return 'disconnected';
    return 'created';
  }
  const internal = String(ch.status || '').toLowerCase();
  if (internal === 'active') return 'connected';
  if (ch.external_id) return 'created';
  return 'disconnected';
}

/**
 * Garante que cada canal tenha o campo "type" no JSON (contrato do frontend).
 * Canais Evolution (provider === 'evolution') retornam sempre type: "whatsapp" para os botões aparecerem.
 */
function normalizeChannelForApi(ch) {
  if (!ch || typeof ch !== 'object') return ch;
  const providerLc = String(ch.provider || '').toLowerCase();
  const isEvolution = providerLc === 'evolution';
  const isWaha = providerLc === 'waha';
  const isZapi = providerLc === 'zapi';
  const type =
    isEvolution || isWaha || isZapi
      ? 'whatsapp'
      : (ch.type != null && String(ch.type).trim() !== '')
        ? String(ch.type).trim().toLowerCase()
        : 'api';
  if (isEvolution || isWaha || isZapi) {
    return { ...ch, type, status: evolutionUiStatus(ch) };
  }
  return { ...ch, type };
}

/** Inclui flowPhase / nextAction para WhatsApp (SaaS). */
function enrichChannelForApi(ch) {
  const base = normalizeChannelForApi(ch);
  const t = (base.type || ch.type || '').toLowerCase();
  if (t === 'whatsapp') {
    base.flowPhase = deriveFlowPhase(ch);
    base.nextAction = nextActionForChannel(ch);
  }
  return base;
}

/**
 * GET /api/channels (e GET /api/agent/channels – mesma rota)
 * Lista canais do tenant no banco. Para instâncias na Evolution use GET /evolution-instances.
 */
router.get('/', requireActiveTenant, async (req, res) => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Tenant não identificado.' });
    }
    const rows = await channelRepo.findAllByTenant(tenantId);
    res.status(200).json(rows.map((ch) => enrichChannelForApi(ch)));
  } catch (err) {
    log.error({ event: 'CHANNELS_LIST_ERROR', context: 'route', error: err?.message || String(err), stack: err?.stack });
    res.status(500).json({ error: err.message || 'Erro ao listar canais.' });
  }
});

/**
 * POST /api/channels/:id/create-instance
 * Compat: redireciona para o fluxo de provisionamento automático.
 */
router.post('/:id/create-instance', requireActiveTenant, async (req, res) => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Tenant não identificado.' });
    }
    const connectOk = await canConnectChannel(tenantId, {
      requestId: req.requestId ?? req.correlationId ?? null,
    });
    if (!connectOk.allowed) {
      return sendTenantPlanLimit(res, connectOk);
    }
    const existing = await channelRepo.findById(req.params.id, tenantId);
    const { result, providerName } = await provisionInstanceWithProvider(
      existing,
      req.requestId ?? req.correlationId ?? null,
    );
    if (!result.ok) {
      return res.status(400).json({ success: false, error: true, message: result.error });
    }
    const ch = await channelRepo.findById(req.params.id, tenantId);
    emitChannelSocketEvent('channel:status', {
      channelId: req.params.id,
      tenantId,
      status: 'PENDING',
      qrCode: null,
      connected: false,
    });
    return res.status(200).json({
      success: true,
      channel: enrichChannelForApi(ch),
      skipped: Boolean(result.skipped),
      ...(result.reason ? { reason: result.reason } : {}),
      nextAction: 'connect',
      legacyAlias: true,
      provider: providerName || null,
    });
  } catch (err) {
    if (err instanceof ProviderAccessError) {
      return sendProviderAccessForbidden(res, err);
    }
    log.error({
      event: 'CHANNEL_CREATE_INSTANCE_ERROR',
      context: 'route',
      tenantId: req.tenantId || req.user?.tenantId || null,
      channelId: req.params?.id ?? null,
      error: err?.message || String(err),
      stack: err?.stack,
    });
    return res.status(500).json({ success: false, error: true, message: 'Erro ao provisionar.' });
  }
});

/**
 * POST /api/channels/:id/provision-instance
 * Provisiona instância na Evolution (após POST /channels em modo SaaS).
 */
router.post('/:id/provision-instance', requireActiveTenant, async (req, res) => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Tenant não identificado.' });
    }
    const connectOk = await canConnectChannel(tenantId, {
      requestId: req.requestId ?? req.correlationId ?? null,
    });
    if (!connectOk.allowed) {
      return sendTenantPlanLimit(res, connectOk);
    }
    const existing = await channelRepo.findById(req.params.id, tenantId);
    log.info({
      event: 'CHANNEL_PROVISION_INSTANCE_START',
      context: 'route',
      tenantId,
      channelId: req.params.id,
      provider: existing?.provider || null,
    });
    const { result, providerName } = await provisionInstanceWithProvider(
      existing,
      req.requestId ?? req.correlationId ?? null,
    );
    if (!result.ok) {
      return res.status(400).json({
        success: false,
        error: true,
        message: result.error || `Não foi possível provisionar a instância do WhatsApp (${providerName || 'provider'}).`,
      });
    }
    const ch = await channelRepo.findById(req.params.id, tenantId);
    return res.status(200).json({
      success: true,
      channel: enrichChannelForApi(ch),
      skipped: Boolean(result.skipped),
      ...(result.reason ? { reason: result.reason } : {}),
      nextAction: 'connect',
      provider: providerName || null,
    });
  } catch (err) {
    if (err instanceof ProviderAccessError) {
      return sendProviderAccessForbidden(res, err);
    }
    log.error({
      event: 'CHANNEL_PROVISION_INSTANCE_ERROR',
      context: 'route',
      tenantId: req.tenantId || req.user?.tenantId || null,
      channelId: req.params?.id ?? null,
      error: err?.message || String(err),
      stack: err?.stack,
    });
    return res.status(500).json({
      success: false,
      error: true,
      message: 'Não foi possível provisionar a instância do WhatsApp.',
    });
  }
});

router.get('/:id/connection-state', requireActiveTenant, async (req, res) => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId;
    if (!tenantId) return res.status(401).json({ error: 'Tenant não identificado.' });

    const channel = await channelRepo.findById(req.params.id, tenantId);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });

    await assertProviderAllowedForTenant({
      tenantId: channel.tenant_id,
      provider: channel.provider,
      channelId: channel.id,
      action: 'connection_state',
      requestId: req.requestId ?? req.correlationId ?? null,
    });
    const state = await channelOrchestrator.resolveConnectionState(channel, {
      correlationId: req.correlationId ?? null,
    });
    return res.status(200).json(state);
  } catch (err) {
    if (err instanceof ProviderAccessError) {
      return sendProviderAccessForbidden(res, err);
    }
    log.error({
      event: 'CHANNEL_CONNECTION_STATE_ERROR',
      context: 'route',
      tenantId: req.tenantId || req.user?.tenantId || null,
      channelId: req.params?.id ?? null,
      error: err?.message || String(err),
      stack: err?.stack,
    });
    return res.status(200).json({
      status: 'error',
      qr: null,
      provider: null,
      lastUpdate: Date.now(),
    });
  }
});

router.get('/:id/qrcode', requireActiveTenant, async (req, res) => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId;
    if (!tenantId) return res.status(401).json({ error: 'Tenant não identificado.' });
    const channel = await channelRepo.findById(req.params.id, tenantId);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    await assertProviderAllowedForTenant({
      tenantId: channel.tenant_id,
      provider: channel.provider,
      channelId: channel.id,
      action: 'qrcode',
      requestId: req.requestId ?? req.correlationId ?? null,
    });
    const state = await channelOrchestrator.resolveConnectionState(channel, {
      correlationId: req.correlationId ?? null,
    });
    return res.status(200).json(state);
  } catch (err) {
    if (err instanceof ProviderAccessError) {
      return sendProviderAccessForbidden(res, err);
    }
    log.error({
      event: 'CHANNEL_QRCODE_ERROR',
      context: 'route',
      tenantId: req.tenantId || req.user?.tenantId || null,
      channelId: req.params?.id ?? null,
      error: err?.message || String(err),
      stack: err?.stack,
    });
    return res.status(200).json({
      status: 'error',
      qr: null,
      provider: null,
      lastUpdate: Date.now(),
    });
  }
});

router.get('/:id/status', requireActiveTenant, async (req, res) => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId;
    if (!tenantId) return res.status(401).json({ error: 'Tenant não identificado.' });
    const channel = await channelRepo.findById(req.params.id, tenantId);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    await assertProviderAllowedForTenant({
      tenantId: channel.tenant_id,
      provider: channel.provider,
      channelId: channel.id,
      action: 'channel_status',
      requestId: req.requestId ?? req.correlationId ?? null,
    });
    const state = await channelOrchestrator.resolveConnectionState(channel, {
      correlationId: req.correlationId ?? null,
    });
    return res.status(200).json(state);
  } catch (err) {
    if (err instanceof ProviderAccessError) {
      return sendProviderAccessForbidden(res, err);
    }
    log.error({
      event: 'CHANNEL_STATUS_ERROR',
      context: 'route',
      tenantId: req.tenantId || req.user?.tenantId || null,
      channelId: req.params?.id ?? null,
      error: err?.message || String(err),
      stack: err?.stack,
    });
    return res.status(200).json({
      status: 'error',
      qr: null,
      provider: null,
      lastUpdate: Date.now(),
    });
  }
});

/**
 * GET /api/channels/:id
 * Retorna o canal com o campo "type" garantido (contrato do frontend).
 */
router.get('/:id', requireActiveTenant, async (req, res) => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Tenant não identificado.' });
    }
    const channel = await channelRepo.findById(req.params.id, tenantId);
    if (!channel) {
      return sendNotFound(res, 'Canal não encontrado.');
    }
    res.status(200).json(enrichChannelForApi(channel));
  } catch (err) {
    log.error({
      event: 'CHANNEL_GET_BY_ID_ERROR',
      context: 'route',
      tenantId: req.tenantId || req.user?.tenantId || null,
      channelId: req.params?.id ?? null,
      error: err?.message || String(err),
      stack: err?.stack,
    });
    res.status(500).json({ error: 'Erro ao buscar canal.' });
  }
});

/**
 * POST /api/channels
 * WhatsApp (SaaS): cria só o registro; provisionamento em POST /:id/provision-instance.
 * WhatsApp (legado): com `instance` preenchido, valida instância na Evolution e persiste vínculo (sem create na Evolution aqui).
 */
router.post('/', requireActiveTenant, async (req, res) => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Tenant não identificado.' });
    }

    const { name, agentId, agent_id, type, instance, active, provider } = req.body || {};
    const fallbackProvidersRaw = req.body?.fallback_providers;
    const configInput = req.body?.config && typeof req.body.config === 'object' ? req.body.config : {};
    const providerConfigInput =
      req.body?.provider_config && typeof req.body.provider_config === 'object'
        ? req.body.provider_config
        : {};
    const finalAgentId = agent_id || agentId;
    const providerLc = String(provider || '').toLowerCase().trim();
    const fallbackProviders = Array.isArray(fallbackProvidersRaw)
      ? [...new Set(fallbackProvidersRaw.map((p) => String(p || '').toLowerCase().trim()).filter(Boolean))]
      : [];

    if (!finalAgentId) {
      return sendBadRequest(res, 'agent_id (ou agentId) é obrigatório.');
    }

    const { rows: agentRows } = await pool.query(
      'SELECT id FROM agents WHERE id = $1 AND tenant_id = $2',
      [finalAgentId, tenantId]
    );
    if (agentRows.length === 0) {
      return sendBadRequest(res, 'Agente não encontrado ou não pertence ao tenant.');
    }

    try {
      await assertCanCreateChannel(tenantId, {
        requestId: req.requestId ?? req.correlationId ?? null,
        logSuccessCheck: true,
      });
    } catch (e) {
      if (e instanceof TenantPlanLimitBlockedError) {
        return sendTenantPlanLimit(res, e.check);
      }
      throw e;
    }

    const channelType = String(type || 'whatsapp').toLowerCase().trim();
    const normalizedInstance =
      instance != null && String(instance).trim() !== ''
        ? String(instance).trim().replace(/\s+/g, '-')
        : '';

    if (channelType === 'whatsapp' && !providerLc) {
      return sendBadRequest(res, 'provider é obrigatório para canais WhatsApp.');
    }
    const limitsRequestId = req.requestId ?? req.correlationId ?? null;
    if (channelType === 'whatsapp' && providerLc) {
      await assertProviderAllowedForTenant({
        tenantId,
        provider: providerLc,
        channelId: null,
        action: 'channel_create',
        requestId: limitsRequestId,
      });
    }

    for (const fp of fallbackProviders) {
      await assertProviderAllowedForTenant({
        tenantId,
        provider: fp,
        channelId: null,
        action: 'channel_create_fallback',
        requestId: limitsRequestId,
      });
    }

    if (!['waha', 'evolution', 'zapi', 'official', 'whatsapp_oficial'].includes(providerLc) && channelType === 'whatsapp') {
      return sendBadRequest(res, 'provider inválido para WhatsApp. Use: waha, evolution, zapi ou official.');
    }

    if (providerLc === 'waha' && channelType !== 'whatsapp') {
      return sendBadRequest(res, 'provider "waha" exige type "whatsapp".');
    }

    const displayName =
      name != null && String(name).trim() !== ''
        ? String(name).trim().slice(0, 100)
        : (normalizedInstance || channelType).slice(0, 100);

    if (channelType === 'whatsapp' && !normalizedInstance) {
      if (!displayName || displayName === channelType) {
        return sendBadRequest(res, 'Informe o nome do canal.');
      }
    }

    if (channelType === 'whatsapp' && normalizedInstance && providerLc !== 'waha') {
      const exists = await channelConnectionService.evolutionInstanceExists(normalizedInstance);
      if (!exists) {
        return sendBadRequest(
          res,
          'Instância não encontrada na Evolution. Verifique o nome ou use o fluxo automático sem informar instância.'
        );
      }
      const dup = await channelRepo.findByTenantTypeAndInstance(tenantId, channelType, normalizedInstance);
      if (dup) {
        return sendBadRequest(
          res,
          'Já existe um canal neste tenant com este tipo e nome de instância.'
        );
      }
    }

    const instanceForDb =
      channelType === 'whatsapp'
        ? normalizedInstance || null
        : normalizedInstance || null;

    let channel;
    try {
      channel = await channelRepo.create({
        tenant_id: tenantId,
        agent_id: finalAgentId,
        type: channelType,
        instance:
          instanceForDb != null
            ? instanceForDb
            : channelType === 'whatsapp'
              ? null
              : displayName.slice(0, 100),
        name: displayName,
        active: active ?? true,
      });
    } catch (insErr) {
      if (insErr.code === '23505') {
        return sendBadRequest(
          res,
          'Já existe um canal com este tipo e instância (restrição única no banco).'
        );
      }
      throw insErr;
    }

    if (channelType !== 'whatsapp') {
      invalidateTenantChannels(tenantId);
      const full = enrichChannelForApi(await channelRepo.findById(channel.id, tenantId));
      return res.status(200).json({ success: true, channel: full });
    }

    if (providerLc === 'waha') {
      const row = await channelRepo.findById(channel.id, tenantId);
      const ext = resolveSessionName(row || channel);
      const cfgDraft = mergeWhatsappConfig(configInput, { phase: WHATSAPP_PHASE.DRAFT });
      await channelRepo.updateConnection(channel.id, tenantId, {
        provider: 'waha',
        fallback_providers: fallbackProviders,
        external_id: ext,
        instance: ext,
        config: cfgDraft,
        provider_config: { session: ext, ...providerConfigInput },
        last_error: null,
      });
      invalidateTenantChannels(tenantId);
      const full = enrichChannelForApi(await channelRepo.findById(channel.id, tenantId));
      const provisioning = await autoProvisionChannel(full);
      return res.status(200).json({
        success: true,
        channel: full,
        nextAction: provisioning.success ? 'connect' : 'provision_instance',
        provider: 'waha',
        provisioning,
      });
    }

    if (normalizedInstance) {
      const cfgLegacy = mergeWhatsappConfig(configInput, {
        phase: WHATSAPP_PHASE.AWAITING_CONNECTION,
      });
      await transitionEvolutionChannelConnection({
        channelId: channel.id,
        tenantId,
        channelRow: channel,
        nextConnectionStatus: CONNECTION.DISCONNECTED,
        evolutionRaw: 'close',
        reason: 'user: canal WhatsApp criado com instância Evolution já existente (fluxo legado)',
        source: 'user',
        patch: {
          provider: 'evolution',
          fallback_providers: fallbackProviders,
          external_id: normalizedInstance,
          instance: normalizedInstance,
          config: cfgLegacy,
          provider_config: { instance: normalizedInstance, ...providerConfigInput },
          last_error: null,
        },
      });
      invalidateTenantChannels(tenantId);
      const full = enrichChannelForApi(await channelRepo.findById(channel.id, tenantId));
      const provisioning = await autoProvisionChannel(full);
      return res.status(200).json({
        success: true,
        channel: full,
        nextAction: 'connect',
        mode: 'legacy_instance',
        provisioning,
      });
    }

    if (providerLc === 'zapi' || providerLc === 'official' || providerLc === 'whatsapp_oficial') {
      const cfgZapi = mergeWhatsappConfig(configInput, { phase: WHATSAPP_PHASE.DRAFT });
      const zapiExternalId =
        String(providerConfigInput?.instanceId || cfgZapi?.zapi?.instanceId || normalizedInstance || '').trim() || null;
      await channelRepo.updateConnection(channel.id, tenantId, {
        provider: providerLc === 'zapi' ? 'zapi' : 'official',
        fallback_providers: fallbackProviders,
        external_id: zapiExternalId,
        instance: zapiExternalId || channel.instance,
        config: cfgZapi,
        provider_config: providerConfigInput,
        last_error: null,
      });
      invalidateTenantChannels(tenantId);
      const full = enrichChannelForApi(await channelRepo.findById(channel.id, tenantId));
      return res.status(200).json({
        success: true,
        channel: full,
        nextAction: 'connect',
        provider: providerLc === 'zapi' ? 'zapi' : 'official',
      });
    }

    const cfgDraft = mergeWhatsappConfig(configInput, { phase: WHATSAPP_PHASE.DRAFT });
    await channelRepo.updateConnection(channel.id, tenantId, {
      provider: providerLc,
      fallback_providers: fallbackProviders,
      config: cfgDraft,
      provider_config: providerConfigInput,
      last_error: null,
    });

    invalidateTenantChannels(tenantId);
    const full = enrichChannelForApi(await channelRepo.findById(channel.id, tenantId));
    const provisioning = await autoProvisionChannel(full);
    return res.status(200).json({
      success: true,
      channel: full,
      nextAction: provisioning.success ? 'connect' : 'provision_instance',
      provisioning,
    });
  } catch (err) {
    if (err instanceof TenantPlanLimitBlockedError) {
      return sendTenantPlanLimit(res, err.check);
    }
    if (err instanceof ProviderAccessError) {
      return sendProviderAccessForbidden(res, err);
    }
    log.error({
      event: 'CHANNEL_CREATE_ERROR',
      context: 'route',
      tenantId: req.tenantId || req.user?.tenantId || null,
      error: err?.message || String(err),
      stack: err?.stack,
    });
    res.status(500).json({ error: 'Erro ao criar canal.' });
  }
});

/**
 * PUT /api/channels/:id
 * Atualiza canal apenas se pertencer ao tenant.
 */
router.put('/:id', requireActiveTenant, async (req, res) => {
  const requestId = req.requestId ?? req.correlationId ?? null;
  try {
    const tenantId = req.tenantId || req.user?.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Tenant não identificado.' });
    }

    const existing = await channelRepo.findById(req.params.id, tenantId);
    if (!existing) {
      return sendNotFound(res, 'Canal não encontrado.');
    }

    const { type, instance, agent_id, active, provider, fallback_providers, config, provider_config } = req.body || {};
    const previousProvider = normalizeProviderId(existing.provider);
    let nextProvider = previousProvider;
    if (provider !== undefined) {
      const raw = String(provider || '').trim();
      if (!raw) {
        return sendBadRequest(res, 'provider inválido.');
      }
      nextProvider = normalizeProviderId(provider);
    }
    const providerChanging = provider !== undefined && nextProvider !== previousProvider;

    const hasConnPatch =
      provider !== undefined || fallback_providers !== undefined || config !== undefined || provider_config !== undefined;

    if (fallback_providers !== undefined) {
      const fbList = Array.isArray(fallback_providers)
        ? [...new Set(fallback_providers.map((p) => normalizeProviderId(p)).filter(Boolean))]
        : [];
      for (const fp of fbList) {
        try {
          await assertProviderAllowedForTenant({
            tenantId,
            provider: fp,
            channelId: req.params.id,
            action: 'channel_update_fallback_list',
            requestId,
          });
        } catch (e) {
          if (e instanceof ProviderAccessError) {
            log.warn({
              event: 'PROVIDER_UPDATE_BLOCKED_BY_PLAN',
              context: 'route',
              tenantId,
              channelId: req.params.id,
              currentProvider: previousProvider,
              nextProvider: fp,
              action: 'channel_update_fallback_list',
              requestId,
            });
            return sendProviderAccessForbidden(res, e);
          }
          throw e;
        }
      }
    }

    if (providerChanging) {
      log.info({
        event: 'PROVIDER_UPDATE_ATTEMPT',
        context: 'route',
        tenantId,
        channelId: req.params.id,
        currentProvider: previousProvider,
        nextProvider,
        action: 'channel_update_provider',
        requestId,
      });
      if (isChannelConnectedBlockingProviderChange(existing)) {
        log.warn({
          event: 'CONNECTED_CHANNEL_PROVIDER_CHANGE_BLOCKED',
          context: 'route',
          tenantId,
          channelId: req.params.id,
          currentProvider: previousProvider,
          nextProvider,
          action: 'channel_update_provider',
          requestId,
        });
        return sendConnectedChannelProviderChangeBlocked(res, new ConnectedChannelProviderChangeError());
      }
      try {
        await assertProviderAllowedForTenant({
          tenantId,
          provider: nextProvider,
          channelId: req.params.id,
          action: 'channel_update_provider',
          requestId,
        });
      } catch (e) {
        if (e instanceof ProviderAccessError) {
          log.warn({
            event: 'PROVIDER_UPDATE_BLOCKED_BY_PLAN',
            context: 'route',
            tenantId,
            channelId: req.params.id,
            currentProvider: previousProvider,
            nextProvider,
            action: 'channel_update_provider',
            requestId,
          });
          return sendProviderAccessForbidden(res, e);
        }
        throw e;
      }
      log.info({
        event: 'PROVIDER_UPDATE_ALLOWED',
        context: 'route',
        tenantId,
        channelId: req.params.id,
        currentProvider: previousProvider,
        nextProvider,
        action: 'channel_update_provider',
        requestId,
      });
    }

    const updated = await channelRepo.update(req.params.id, tenantId, {
      type,
      instance,
      agent_id,
      active,
    });

    if (!hasConnPatch) {
      return res.status(200).json(updated);
    }

    if (provider !== undefined && nextProvider && previousProvider && providerChanging) {
      try {
        await channelConnectionService.disconnectChannel(existing);
      } catch (e) {
        log.warn({
          event: 'CHANNEL_PROVIDER_SWITCH_DISCONNECT_FAILED',
          context: 'route',
          tenantId,
          channelId: req.params?.id ?? null,
          error: e?.message || String(e),
        });
      }
    }

    const updatedConn = await channelRepo.updateConnection(req.params.id, tenantId, {
      ...(provider !== undefined ? { provider: nextProvider || null } : {}),
      ...(fallback_providers !== undefined ? { fallback_providers } : {}),
      ...(config !== undefined ? { config: config && typeof config === 'object' ? config : {} } : {}),
      ...(provider_config !== undefined
        ? { provider_config: provider_config && typeof provider_config === 'object' ? provider_config : {} }
        : {}),
      ...(provider !== undefined ? { connection_status: 'disconnected', connected_at: null, last_error: null } : {}),
    });
    res.status(200).json(updatedConn);
  } catch (err) {
    if (err instanceof ConnectedChannelProviderChangeError) {
      return sendConnectedChannelProviderChangeBlocked(res, err);
    }
    if (err instanceof ProviderAccessError) {
      return sendProviderAccessForbidden(res, err);
    }
    log.error({
      event: 'CHANNEL_UPDATE_ERROR',
      context: 'route',
      tenantId: req.tenantId || req.user?.tenantId || null,
      channelId: req.params?.id ?? null,
      error: err?.message || String(err),
      stack: err?.stack,
    });
    res.status(500).json({ error: 'Erro ao atualizar canal.' });
  }
});

/**
 * DELETE /api/channels/:id
 * Remove canal apenas se pertencer ao tenant.
 */
router.delete('/:id', requireActiveTenant, async (req, res) => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Tenant não identificado.' });
    }

    const existing = await channelRepo.findById(req.params.id, tenantId);
    if (!existing) {
      return sendNotFound(res, 'Canal não encontrado.');
    }

    const ext = existing.external_id != null ? String(existing.external_id).trim() : '';
    const prov = String(existing.provider || '').toLowerCase();
    if (prov) {
      await assertProviderAllowedForTenant({
        tenantId: existing.tenant_id,
        provider: prov,
        channelId: existing.id,
        action: 'channel_delete',
        requestId: req.requestId ?? req.correlationId ?? null,
      });
    }
    if (prov && ext) {
      try {
        const provider = getProviderForChannel(existing);
        try {
          await provider.disconnect(existing);
        } catch (e) {
          log.warn({
            event: 'CHANNEL_DELETE_DISCONNECT_FAILED',
            context: 'route',
            tenantId,
            channelId: req.params?.id ?? null,
            provider: prov,
            error: e?.message || String(e),
          });
        }
        try {
          const rm = await provider.removeInstance(existing);
          if (rm?.skipped) {
            log.warn({
              event: 'CHANNEL_DELETE_REMOVE_INSTANCE_UNSUPPORTED',
              context: 'route',
              tenantId,
              channelId: existing.id,
              provider: prov,
              metadata: { reason: rm?.reason || null },
            });
          }
        } catch (e) {
          log.warn({
            event: 'CHANNEL_DELETE_REMOVE_INSTANCE_FAILED',
            context: 'route',
            tenantId,
            channelId: req.params?.id ?? null,
            provider: prov,
            error: e?.message || String(e),
          });
        }
      } catch (e) {
        log.warn({
          event: 'CHANNEL_DELETE_PROVIDER_ABSTRACTION_UNAVAILABLE',
          context: 'route',
          tenantId,
          channelId: req.params?.id ?? null,
          provider: prov,
          error: e?.message || String(e),
        });
      }
    } else if (prov === 'waha') {
      log.info({
        event: 'CHANNEL_DELETE_WAHA_WITHOUT_EXTERNAL_ID',
        context: 'route',
        tenantId,
        channelId: existing.id,
        provider: 'waha',
      });
    }

    await channelRepo.deleteById(req.params.id, tenantId);
    invalidateTenantChannels(tenantId);
    res.status(204).send();
  } catch (err) {
    if (err instanceof ProviderAccessError) {
      return sendProviderAccessForbidden(res, err);
    }
    log.error({
      event: 'CHANNEL_DELETE_ERROR',
      context: 'route',
      tenantId: req.tenantId || req.user?.tenantId || null,
      channelId: req.params?.id ?? null,
      error: err?.message || String(err),
      stack: err?.stack,
    });
    res.status(500).json({ error: 'Erro ao remover canal.' });
  }
});

export default router;
