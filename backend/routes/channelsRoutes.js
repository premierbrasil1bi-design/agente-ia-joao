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

const router = Router();
router.use(agentAuth);

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
  return { ...ch, type };
}

/**
 * GET /api/channels (e GET /api/agent/channels – mesma rota)
 * Retorna todos os canais do tenant do usuário logado.
 * Garante que cada item inclua o campo "type" para o frontend exibir os botões WhatsApp.
 */
router.get('/', requireActiveTenant, async (req, res) => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Tenant não identificado.' });
    }
    const list = await channelRepo.findAllByTenant(tenantId);
    const normalized = Array.isArray(list) ? list.map(normalizeChannelForApi) : [];
    res.status(200).json(normalized);
  } catch (err) {
    console.error('[channels] GET /:', err.message);
    res.status(500).json({ error: 'Erro ao listar canais.' });
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
    res.status(200).json(normalizeChannelForApi(channel));
  } catch (err) {
    console.error('[channels] GET /:id:', err.message);
    res.status(500).json({ error: 'Erro ao buscar canal.' });
  }
});

/**
 * POST /api/channels
 * Fluxo completo de criação de canal WhatsApp via Evolution:
 * 1) Cria canal no banco
 * 2) Cria/usa instância na Evolution API
 * 3) Atualiza dados externos (provider, external_id, status, config)
 *
 * Body recomendado (Client App):
 *   { name, agentId }
 *
 * Compatibilidade: ainda aceita { type, instance, agent_id, active }.
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

    // Criação do canal no banco (type/instance opcionais; padrão para WhatsApp Evolution)
    const channel = await channelRepo.create({
      tenant_id: tenantId,
      agent_id: finalAgentId,
      type: type || 'whatsapp',
      instance: instance || name || null,
      active: active ?? true,
    });

    try {
      // Cria a instância na Evolution SEM conectar (status: created).
      const evolutionResult = await channelConnectionService.createWhatsAppInstance({
        ...channel,
        tenant_id: tenantId,
      });

      const fullChannel =
        evolutionResult.channel ??
        (await channelRepo.findById(channel.id, tenantId));

      return res.status(201).json({
        success: true,
        channel: fullChannel,
        evolution: {
          instance: evolutionResult.instanceName,
          create: evolutionResult.createResponse,
        },
      });
    } catch (e) {
      // Não deixar canal "fake" sem Evolution: remove o registro e retorna erro.
      await channelRepo.deleteById(channel.id, tenantId);
      console.error('[channels] POST / (evolution error):', e.message);
      return res.status(502).json({
        success: false,
        error: 'Falha ao criar instância na Evolution. Canal não foi criado.',
      });
    }
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

    await channelRepo.deleteById(req.params.id, tenantId);
    res.status(204).send();
  } catch (err) {
    console.error('[channels] DELETE /:id:', err.message);
    res.status(500).json({ error: 'Erro ao remover canal.' });
  }
});

export default router;
