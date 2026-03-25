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
import {
  deriveFlowPhase,
  nextActionForChannel,
  WHATSAPP_PHASE,
  mergeWhatsappConfig,
} from '../utils/whatsappChannelFlow.js';
import { invalidateTenantChannels } from '../utils/channelCache.js';
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
  const isEvolution = String(ch.provider || '').toLowerCase() === 'evolution';
  const type =
    isEvolution
      ? 'whatsapp'
      : (ch.type != null && String(ch.type).trim() !== '')
        ? String(ch.type).trim().toLowerCase()
        : 'api';
  if (isEvolution) {
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
    const result = await evolutionProvision.provisionWhatsAppInstance(req.params.id, tenantId);
    if (!result.ok) {
      return res.status(400).json({ success: false, error: true, message: result.error });
    }
    const ch = await channelRepo.findById(req.params.id, tenantId);
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

    const { name, agentId, agent_id, type, instance, active } = req.body || {};
    const finalAgentId = agent_id || agentId;

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

    const displayName =
      name != null && String(name).trim() !== ''
        ? String(name).trim().slice(0, 100)
        : (normalizedInstance || channelType).slice(0, 100);

    if (channelType === 'whatsapp' && !normalizedInstance) {
      if (!displayName || displayName === channelType) {
        return sendBadRequest(res, 'Informe o nome do canal.');
      }
    }

    if (channelType === 'whatsapp' && normalizedInstance) {
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

    if (normalizedInstance) {
      const cfgLegacy = mergeWhatsappConfig({}, {
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
          external_id: normalizedInstance,
          instance: normalizedInstance,
          config: cfgLegacy,
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

    const cfgDraft = mergeWhatsappConfig({}, { phase: WHATSAPP_PHASE.DRAFT });
    await channelRepo.updateConnection(channel.id, tenantId, {
      config: cfgDraft,
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

    const { type, instance, agent_id, active } = req.body || {};
    const updated = await channelRepo.update(req.params.id, tenantId, {
      type,
      instance,
      agent_id,
      active,
    });
    res.status(200).json(updated);
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
    if (String(existing.provider || '').toLowerCase() === 'evolution' && ext) {
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
