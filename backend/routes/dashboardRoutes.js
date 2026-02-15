/**
 * Rotas do painel administrativo (Dashboard).
 * Erro de dados/banco NUNCA retorna 500: sempre 200 com fallback (zerado ou vazio).
 * Erro de autenticação é tratado pelo middleware requireAdminAuth (401/403).
 */

import { Router } from 'express';
import { hasDatabaseUrl } from '../config/env.js';
import * as dashboardService from '../services/dashboardService.js';
import * as clientsRepo from '../repositories/clientsRepository.js';

const router = Router();
const LOG_PREFIX = '[dashboard]';

function safeJson(res, data) {
  try {
    return res.status(200).json(data);
  } catch (err) {
    console.error(`${LOG_PREFIX} res.json:`, err.message);
    return res.status(200).json({});
  }
}

// GET /dashboard/summary
router.get('/summary', async (req, res) => {
  try {
    const clientId = req.query.client_id || null;
    const data = await dashboardService.getSummary(clientId);
    return safeJson(res, data);
  } catch (err) {
    console.error(`${LOG_PREFIX} GET /summary:`, err.message);
    return safeJson(res, dashboardService.fallback.summary());
  }
});

// GET /dashboard/agents
router.get('/agents', async (req, res) => {
  try {
    const clientId = req.query.client_id || null;
    const data = await dashboardService.getAgents(clientId);
    return safeJson(res, data);
  } catch (err) {
    console.error(`${LOG_PREFIX} GET /agents:`, err.message);
    return safeJson(res, dashboardService.fallback.agents());
  }
});

// GET /dashboard/channels
router.get('/channels', async (req, res) => {
  try {
    const agentId = req.query.agent_id || null;
    const data = await dashboardService.getChannels(agentId);
    return safeJson(res, data);
  } catch (err) {
    console.error(`${LOG_PREFIX} GET /channels:`, err.message);
    return safeJson(res, dashboardService.fallback.channels());
  }
});

// GET /dashboard/costs
router.get('/costs', async (req, res) => {
  try {
    const agentId = req.query.agent_id || null;
    const filters = {
      period: req.query.period || null,
      from: req.query.from || null,
      to: req.query.to || null,
    };
    const data = await dashboardService.getCosts(agentId, filters);
    return safeJson(res, data);
  } catch (err) {
    console.error(`${LOG_PREFIX} GET /costs:`, err.message);
    return safeJson(res, dashboardService.fallback.costs());
  }
});

// GET /dashboard/messages – agent_id obrigatório
router.get('/messages', async (req, res) => {
  if (!req.query.agent_id) {
    return res.status(400).json({ error: 'agent_id é obrigatório.', code: 'BAD_REQUEST' });
  }
  try {
    const options = {
      channelId: req.query.channel_id || null,
      limit: parseInt(req.query.limit, 10) || 100,
      offset: parseInt(req.query.offset, 10) || 0,
    };
    const data = await dashboardService.getMessages(req.query.agent_id, options);
    return safeJson(res, data);
  } catch (err) {
    console.error(`${LOG_PREFIX} GET /messages:`, err.message);
    return safeJson(res, dashboardService.fallback.messages());
  }
});

// GET /dashboard/prompts – agent_id obrigatório
router.get('/prompts', async (req, res) => {
  if (!req.query.agent_id) {
    return res.status(400).json({ error: 'agent_id é obrigatório.', code: 'BAD_REQUEST' });
  }
  try {
    const data = await dashboardService.getPrompts(req.query.agent_id);
    return safeJson(res, data);
  } catch (err) {
    console.error(`${LOG_PREFIX} GET /prompts:`, err.message);
    return safeJson(res, dashboardService.fallback.prompts());
  }
});

// GET /dashboard/clients – retorna apenas clientes reais do banco (nunca mock com id '1').
// Lista vazia = usuário deve cadastrar cliente ou rodar seed antes de criar agentes.
router.get('/clients', async (req, res) => {
  try {
    if (!hasDatabaseUrl()) {
      return safeJson(res, []);
    }
    const data = await clientsRepo.findAll();
    return safeJson(res, Array.isArray(data) ? data : []);
  } catch (err) {
    console.error(`${LOG_PREFIX} GET /clients:`, err.message);
    return safeJson(res, []);
  }
});

export default router;
