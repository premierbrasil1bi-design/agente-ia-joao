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
import * as evolutionService from '../services/evolutionService.js';
import * as evolutionGateway from '../controllers/evolutionGateway.controller.js';
import * as evolutionProvision from '../services/evolutionProvision.service.js';
import * as wahaProvision from '../services/wahaProvision.service.js';
import {
  deriveFlowPhase,
  nextActionForChannel,
  WHATSAPP_PHASE,
  mergeWhatsappConfig,
} from '../utils/whatsappChannelFlow.js';
import { invalidateTenantChannels } from '../utils/channelCache.js';
import { resolveSessionName } from '../utils/resolveSessionName.js';
import { emitChannelSocketEvent } from '../utils/channelRealtime.js';
import {
  CONNECTION,
  transitionEvolutionChannelConnection,
} from '../services/channelEvolutionState.service.js';

const router = Router();

router.use(agentAuth);

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

function normalizeChannelStatus(status) {
  if (!status) return 'DISCONNECTED';
  const s = String(status).toLowerCase();
  if (['connected', 'online', 'open'].includes(s)) return 'CONNECTED';
  if (['connecting', 'pending', 'qr', 'created', 'awaiting_connection'].includes(s)) return 'PENDING';
  if (['disconnected', 'closed', 'close', 'inactive', 'offline', 'error'].includes(s)) return 'DISCONNECTED';
  return 'DISCONNECTED';
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
    console.error('[channels] GET /:', err.message);
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
    const existing = await channelRepo.findById(req.params.id, tenantId);
    if (existing && String(existing.provider || '').toLowerCase() === 'waha') {
      const result = await wahaProvision.provisionWhatsAppInstance(req.params.id, tenantId);
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
        provider: 'waha',
      });
    }
    const result = await evolutionProvision.provisionWhatsAppInstance(req.params.id, tenantId);
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
    });
  } catch (err) {
    console.error('[channels] create-instance:', err.message);
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
    const existing = await channelRepo.findById(req.params.id, tenantId);
    console.log('[CHANNEL] [PROVISION] Creating instance', {
      channelId: req.params.id,
      tenantId,
      provider: existing?.provider || null,
    });
    if (existing && String(existing.provider || '').toLowerCase() === 'waha') {
      const result = await wahaProvision.provisionWhatsAppInstance(req.params.id, tenantId);
      if (!result.ok) {
        return res.status(400).json({
          success: false,
          error: true,
          message: result.error || 'Não foi possível preparar o canal WAHA.',
        });
      }
      const ch = await channelRepo.findById(req.params.id, tenantId);
      return res.status(200).json({
        success: true,
        channel: enrichChannelForApi(ch),
        skipped: Boolean(result.skipped),
        ...(result.reason ? { reason: result.reason } : {}),
        nextAction: 'connect',
        provider: 'waha',
      });
    }
    const result = await evolutionProvision.provisionWhatsAppInstance(req.params.id, tenantId);
    if (!result.ok) {
      return res.status(400).json({
        success: false,
        error: true,
        message: result.error || 'Não foi possível provisionar a instância do WhatsApp.',
      });
    }
    const ch = await channelRepo.findById(req.params.id, tenantId);
    return res.status(200).json({
      success: true,
      channel: enrichChannelForApi(ch),
      skipped: Boolean(result.skipped),
      ...(result.reason ? { reason: result.reason } : {}),
      nextAction: 'connect',
    });
  } catch (err) {
    console.error('[channels] provision-instance:', err.message);
    return res.status(500).json({
      success: false,
      error: true,
      message: 'Não foi possível provisionar a instância do WhatsApp.',
    });
  }
});

router.get('/:id/qrcode', requireActiveTenant, async (req, res) => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Tenant não identificado.' });
    }

    const channel = await channelRepo.findById(req.params.id, tenantId);
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    const qrData = await channelConnectionService.getChannelQrCode(channel).catch(() => null);
    const qrPayload =
      channel.qr_code ||
      qrData?.qr ||
      qrData?.qrcode ||
      qrData?.base64 ||
      qrData?.data ||
      null;
    const normalizedStatus = normalizeChannelStatus(channel.connection_status || channel.status);

    if (!qrPayload) {
      return res.json({
        qrCode: null,
        qr: null,
        qrcode: null,
        status: normalizedStatus,
        message: 'QR ainda não disponível',
      });
    }

    console.log('[CHANNEL] [QR] Generated', { id: req.params.id, tenantId });

    return res.json({
      qrCode: qrPayload,
      qr: qrPayload,
      qrcode: qrPayload,
      status: normalizedStatus,
    });
  } catch (err) {
    console.error('[channels] qrcode:', err.message);
    return res.status(500).json({ error: 'Failed to get QR code' });
  }
});

router.get('/:id/status', requireActiveTenant, async (req, res) => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Tenant não identificado.' });
    }

    const channel = await channelRepo.findById(req.params.id, tenantId);
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    const statusData = await channelConnectionService.getChannelStatus(channel).catch(() => null);
    const status =
      statusData?.normalizedStatus ||
      statusData?.publicStatus ||
      channel.connection_status ||
      channel.status ||
      'disconnected';
    const normalizedStatus = normalizeChannelStatus(status);
    const connected = normalizedStatus === 'CONNECTED';

    if (connected) {
      console.log('[CHANNEL] [STATUS] CONNECTED', { id: req.params.id, tenantId });
    }

    return res.json({
      status: normalizedStatus,
      connected,
      channel: statusData?.channel || channel,
    });
  } catch (err) {
    console.error('[channels] status:', err.message);
    return res.status(500).json({ error: 'Failed to get status' });
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
    console.error('[channels] GET /:id:', err.message);
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

    const channelType = String(type || 'whatsapp').toLowerCase().trim();
    const normalizedInstance =
      instance != null && String(instance).trim() !== ''
        ? String(instance).trim().replace(/\s+/g, '-')
        : '';

    if (channelType === 'whatsapp' && !providerLc) {
      return sendBadRequest(res, 'provider é obrigatório para canais WhatsApp.');
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
      return res.status(200).json({
        success: true,
        channel: full,
        nextAction: 'provision_instance',
        provider: 'waha',
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
      return res.status(200).json({
        success: true,
        channel: full,
        nextAction: 'connect',
        mode: 'legacy_instance',
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
    return res.status(200).json({
      success: true,
      channel: full,
      nextAction: 'provision_instance',
    });
  } catch (err) {
    console.error('[channels] POST /:', err.message);
    res.status(500).json({ error: 'Erro ao criar canal.' });
  }
});

/**
 * PUT /api/channels/:id
 * Atualiza canal apenas se pertencer ao tenant.
 */
router.put('/:id', requireActiveTenant, async (req, res) => {
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
    const previousProvider = String(existing.provider || '').toLowerCase().trim();
    const nextProvider = provider !== undefined ? String(provider || '').toLowerCase().trim() : previousProvider;
    const updated = await channelRepo.update(req.params.id, tenantId, {
      type,
      instance,
      agent_id,
      active,
    });
    const hasConnPatch =
      provider !== undefined || fallback_providers !== undefined || config !== undefined || provider_config !== undefined;
    if (!hasConnPatch) {
      return res.status(200).json(updated);
    }
    if (provider !== undefined && nextProvider && previousProvider && nextProvider !== previousProvider) {
      try {
        // Produção: desconecta provider anterior antes da troca para evitar estado zumbi.
        await channelConnectionService.disconnectChannel(existing);
      } catch (e) {
        console.warn('[channels] PUT provider-switch: disconnect anterior falhou (seguindo com reset):', e.message);
      }
    }

    const updatedConn = await channelRepo.updateConnection(req.params.id, tenantId, {
      ...(provider !== undefined ? { provider: String(provider || '').toLowerCase().trim() || null } : {}),
      ...(fallback_providers !== undefined ? { fallback_providers } : {}),
      ...(config !== undefined ? { config: config && typeof config === 'object' ? config : {} } : {}),
      ...(provider_config !== undefined
        ? { provider_config: provider_config && typeof provider_config === 'object' ? provider_config : {} }
        : {}),
      ...(provider !== undefined ? { connection_status: 'disconnected', connected_at: null, last_error: null } : {}),
    });
    res.status(200).json(updatedConn);
  } catch (err) {
    console.error('[channels] PUT /:id:', err.message);
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
    if (prov === 'waha') {
      // WAHA Core (free): single-session "default" pode ser compartilhada.
      // Ao remover um canal local, não encerrar/deletar a sessão remota (evita derrubar outros canais/agentes).
      console.log('[channels] DELETE: WAHA channel removido (não encerra sessão remota)', {
        channelId: existing.id,
        external_id: ext || null,
      });
    } else if (prov === 'evolution' && ext) {
      try {
        await evolutionService.deleteInstance(ext);
        console.log('[channels] DELETE: deleteInstance Evolution OK:', ext);
      } catch (e) {
        console.warn('[channels] DELETE: deleteInstance falhou, tentando logout + delete:', e.message);
        try {
          await evolutionService.disconnectInstance(ext);
          await evolutionService.deleteInstance(ext);
          console.log('[channels] DELETE: Evolution removida após logout:', ext);
        } catch (e2) {
          console.warn('[channels] DELETE: Evolution (seguindo exclusão no banco):', e2.message);
        }
      }
    }

    await channelRepo.deleteById(req.params.id, tenantId);
    invalidateTenantChannels(tenantId);
    res.status(204).send();
  } catch (err) {
    console.error('[channels] DELETE /:id:', err.message);
    res.status(500).json({ error: 'Erro ao remover canal.' });
  }
});

export default router;
