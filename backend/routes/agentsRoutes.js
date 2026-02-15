/**
 * Rotas CRUD de agentes – painel Admin.
 * Todas as rotas exigem requireAdminAuth.
 * Nenhuma rota retorna 500 por tabela vazia ou erro previsível.
 */

import { Router } from 'express';
import * as agentsRepo from '../repositories/agentsRepository.js';
import * as clientsRepo from '../repositories/clientsRepository.js';
import * as channelsRepo from '../repositories/channelsRepository.js';
import * as promptsRepo from '../repositories/promptsRepository.js';
import * as contextService from '../services/contextService.js';
import { isConnected } from '../db/connection.js';
import { sendBadRequest, sendNotFound } from '../utils/errorResponses.js';
import { sanitizeString } from '../utils/sanitize.js';

const PROMPT_BASE_DEFAULT = 'Você é um assistente prestativo. Responda em português de forma clara e objetiva.';

const router = Router();
const LOG_PREFIX = '[agents]';

const NAME_MAX = 255;
const SLUG_MAX = 100;

function slugFromName(name) {
  const s = String(name || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
  return s.slice(0, SLUG_MAX) || 'agente';
}

/**
 * GET /api/agents – lista agentes (opcional: ?client_id=)
 * Retorna [] se banco desconectado ou erro; nunca 500.
 */
router.get('/', async (req, res) => {
  const clientId = req.query.client_id || null;
  try {
    if (!isConnected()) {
      return res.status(200).json([]);
    }
    const list = await agentsRepo.findAll(clientId);
    return res.status(200).json(Array.isArray(list) ? list : []);
  } catch (err) {
    if (err.message && err.message.includes('DATABASE_URL')) {
      return res.status(200).json([]);
    }
    console.error(`${LOG_PREFIX} GET /:`, err.message);
    return res.status(200).json([]);
  }
});

/**
 * POST /api/agents – criar agente.
 * Body: { client_id (ou client), name, slug?, channel? }. channel em query (?channel=) ou body.
 * slug opcional (gerado a partir de name); slug duplicado gera slug único (slug-1, slug-2...).
 * Retorna 201 com o agente criado; 400 com mensagem clara se faltar campo obrigatório.
 */
router.post('/', async (req, res) => {
  const body = req.body || {};
  console.error(`${LOG_PREFIX} POST / body recebido:`, JSON.stringify(body));

  const clientId =
    sanitizeString(body.client_id ?? body.client, 36).trim() || null;
  const name = sanitizeString(body.name, NAME_MAX).trim();
  let slug = sanitizeString(body.slug, SLUG_MAX).trim();
  const channelRaw =
    req.query.channel ?? body.channel ?? 'web';
  const channel = String(channelRaw).toLowerCase().trim() || 'web';

  if (!clientId) {
    return sendBadRequest(res, 'client_id é obrigatório.');
  }
  if (!name) {
    return sendBadRequest(res, 'name é obrigatório.');
  }
  if (!slug) slug = slugFromName(name);

  try {
    if (!isConnected()) {
      return sendBadRequest(res, 'Banco de dados não disponível. Tente mais tarde.');
    }
    const client = await clientsRepo.findById(clientId);
    if (!client) {
      return sendBadRequest(
        res,
        'Cliente não encontrado. Cadastre um cliente no banco (ou rode o seed) e selecione-o na lista.'
      );
    }
    let slugFinal = slug.slice(0, SLUG_MAX);
    let n = 0;
    const SLUG_MAX_SUFFIX = 1000;
    while (n < SLUG_MAX_SUFFIX) {
      const exists = await agentsRepo.existsByClientAndSlug(clientId, slugFinal);
      if (!exists) break;
      n += 1;
      const suffix = n === 1 ? '-1' : `-${n}`;
      slugFinal = (slug.slice(0, SLUG_MAX - suffix.length) + suffix).slice(0, SLUG_MAX);
    }
    const agent = await agentsRepo.create({
      clientId,
      name,
      slug: slugFinal,
      status: 'ativo',
    });
    if (agent?.id) {
      try {
        const chList = await channelsRepo.findByAgentId(agent.id);
        const channelType = ['web', 'api', 'whatsapp', 'instagram'].includes(channel) ? channel : 'web';
        const hasChannel = chList.some((c) => (c.type || '').toLowerCase() === channelType);
        if (!hasChannel) {
          await channelsRepo.create({
            agentId: agent.id,
            name: channelType === 'web' ? 'Web' : channelType,
            type: channelType,
            status: 'offline',
            isActive: true,
          });
        }
        const promptBase = await promptsRepo.findBaseByAgentId(agent.id);
        if (!promptBase) {
          await promptsRepo.create({
            agentId: agent.id,
            channelId: null,
            content: PROMPT_BASE_DEFAULT,
            version: 1,
          });
        }
      } catch (linkErr) {
        // agente já criado; canal/prompt podem ser configurados depois
      }
    }
    return res.status(201).json(agent);
  } catch (err) {
    if (err.code === '23505') {
      return sendBadRequest(res, 'Já existe um agente com este nome/slug neste cliente.');
    }
    console.error(`${LOG_PREFIX} POST /:`, err.message);
    return sendBadRequest(res, 'Não foi possível criar o agente. Tente novamente.');
  }
});

/**
 * GET /api/agents/:id – agente com contexto e prompts (para canal WEB).
 * Retorna 200 com { agent, context, prompts } (prompts = [] se vazio).
 */
router.get('/:id', async (req, res) => {
  const id = (req.params.id || '').trim();
  if (!id) {
    return sendBadRequest(res, 'id do agente é obrigatório.');
  }
  try {
    if (!isConnected()) {
      return res.status(200).json({
        agent: null,
        context: { client_id: null, agent_id: id, channel: 'WEB', prompt_id: null, canal_nome: 'WEB' },
        prompts: [],
      });
    }
    const agent = await agentsRepo.findById(id);
    if (!agent) {
      return sendNotFound(res, 'Agente não encontrado.');
    }
    const clientId = agent.client_id ?? null;
    const ctx = await contextService.getContext(clientId, id, 'web');
    const prompts = await promptsRepo.findByAgentId(id);
    return res.status(200).json({
      agent,
      context: ctx,
      prompts: Array.isArray(prompts) ? prompts : [],
    });
  } catch (err) {
    console.error(`${LOG_PREFIX} GET /:id:`, err.message);
    return res.status(200).json({
      agent: null,
      context: { client_id: null, agent_id: id, channel: 'WEB', prompt_id: null, canal_nome: 'WEB' },
      prompts: [],
    });
  }
});

/**
 * PUT /api/agents/:id – editar agente.
 * Body: { name?, slug?, status? }
 */
router.put('/:id', async (req, res) => {
  const id = (req.params.id || '').trim();
  const body = req.body || {};
  if (!id) {
    return sendBadRequest(res, 'id do agente é obrigatório.');
  }

  const name = body.name !== undefined ? sanitizeString(body.name, NAME_MAX).trim() : null;
  const slug = body.slug !== undefined ? sanitizeString(body.slug, SLUG_MAX).trim() : null;
  const status = body.status !== undefined ? String(body.status).toLowerCase() : null;
  if (status && !['ativo', 'inativo', 'erro'].includes(status)) {
    return sendBadRequest(res, 'status deve ser ativo, inativo ou erro.');
  }

  try {
    if (!isConnected()) {
      return sendBadRequest(res, 'Banco de dados não disponível.');
    }
    const existing = await agentsRepo.findById(id);
    if (!existing) {
      return sendNotFound(res, 'Agente não encontrado.');
    }
    const updates = {
      name: name || existing.name,
      slug: slug || existing.slug,
      status: status || existing.status,
    };
    const agent = await agentsRepo.update(id, updates);
    if (!agent) {
      return sendNotFound(res, 'Agente não encontrado.');
    }
    return res.status(200).json(agent);
  } catch (err) {
    if (err.code === '23505') {
      return sendBadRequest(res, 'Já existe um agente com este slug neste cliente.');
    }
    console.error(`${LOG_PREFIX} PUT /:id:`, err.message);
    return sendBadRequest(res, 'Não foi possível atualizar o agente. Tente novamente.');
  }
});

/**
 * DELETE /api/agents/:id – desativar agente (soft delete).
 * Retorna 200 com { success: true, agent }.
 */
router.delete('/:id', async (req, res) => {
  const id = (req.params.id || '').trim();
  if (!id) {
    return sendBadRequest(res, 'id do agente é obrigatório.');
  }

  try {
    if (!isConnected()) {
      return sendBadRequest(res, 'Banco de dados não disponível.');
    }
    const existing = await agentsRepo.findById(id);
    if (!existing) {
      return sendNotFound(res, 'Agente não encontrado.');
    }
    const agent = await agentsRepo.setStatus(id, 'inativo');
    return res.status(200).json({ success: true, agent: agent || existing });
  } catch (err) {
    console.error(`${LOG_PREFIX} DELETE /:id:`, err.message);
    return sendBadRequest(res, 'Não foi possível desativar o agente. Tente novamente.');
  }
});

export default router;
