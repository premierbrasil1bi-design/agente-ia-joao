import * as agentsRepo from '../repositories/agentsRepository.js';
import { toAgentApiRow } from '../utils/agentMapper.js';
import { getTenantById } from '../repositories/tenant.repository.js';

/**
 * GET /api/global-admin/tenants/:tenantId/agents
 */
export async function listAgents(req, res) {
  try {
    const { tenantId } = req.params;
    const tenant = await getTenantById(tenantId);
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant não encontrado' });
    }
    const rows = await agentsRepo.findByTenantId(tenantId);
    const list = rows.map((r) => toAgentApiRow(r));
    res.status(200).json(list);
  } catch (err) {
    console.error('[global-admin] listAgents:', err.message);
    res.status(500).json({ error: 'Erro ao listar agentes' });
  }
}

/**
 * POST /api/global-admin/tenants/:tenantId/agents
 */
export async function createAgent(req, res) {
  try {
    const { tenantId } = req.params;
    const tenant = await getTenantById(tenantId);
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant não encontrado' });
    }
    const { name, slug, description, status } = req.body || {};
    const agent = await agentsRepo.createForTenant(tenantId, {
      name,
      slug,
      description,
      status: status || 'ativo',
    });
    res.status(201).json(toAgentApiRow(agent));
  } catch (err) {
    console.error('[global-admin] createAgent:', err.message);
    res.status(500).json({ error: 'Erro ao criar agente' });
  }
}

/**
 * PATCH /api/global-admin/agents/:agentId
 */
export async function updateAgent(req, res) {
  try {
    const { agentId } = req.params;
    const { name, slug, description, status } = req.body || {};
    const agent = await agentsRepo.findById(agentId);
    if (!agent) {
      return res.status(404).json({ error: 'Agente não encontrado' });
    }
    const updated = await agentsRepo.update(agentId, {
      name,
      slug,
      description,
      status,
    });
    res.status(200).json(toAgentApiRow(updated));
  } catch (err) {
    console.error('[global-admin] updateAgent:', err.message);
    res.status(500).json({ error: 'Erro ao atualizar agente' });
  }
}

/**
 * DELETE /api/global-admin/agents/:agentId
 */
export async function deleteAgent(req, res) {
  try {
    const { agentId } = req.params;
    const agent = await agentsRepo.findById(agentId);
    if (!agent) {
      return res.status(404).json({ error: 'Agente não encontrado' });
    }
    await agentsRepo.remove(agentId);
    res.status(204).send();
  } catch (err) {
    console.error('[global-admin] deleteAgent:', err.message);
    res.status(500).json({ error: 'Erro ao remover agente' });
  }
}
