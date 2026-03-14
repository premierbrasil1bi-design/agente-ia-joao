import * as channelsRepo from '../repositories/channelsRepository.js';
import * as agentsRepo from '../repositories/agentsRepository.js';
import { toChannelApiRow } from '../utils/channelMapper.js';
import { getTenantById } from '../repositories/tenant.repository.js';

/**
 * GET /api/global-admin/tenants/:tenantId/channels
 */
export async function listChannels(req, res) {
  try {
    const { tenantId } = req.params;
    const tenant = await getTenantById(tenantId);
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant não encontrado' });
    }
    const rows = await channelsRepo.findByTenantId(tenantId);
    const list = rows.map((r) => toChannelApiRow(r));
    res.status(200).json(list);
  } catch (err) {
    console.error('[global-admin] listChannels:', err.message);
    res.status(500).json({ error: 'Erro ao listar canais' });
  }
}

/**
 * POST /api/global-admin/tenants/:tenantId/channels
 */
export async function createChannel(req, res) {
  try {
    const { tenantId } = req.params;
    const tenant = await getTenantById(tenantId);
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant não encontrado' });
    }
    const { agent_id, agentId, type, name, config, status } = req.body || {};
    const aid = agent_id || agentId;
    if (!aid) {
      return res.status(400).json({ error: 'agent_id é obrigatório' });
    }
    const agent = await agentsRepo.findByIdAndTenantId(aid, tenantId);
    if (!agent) {
      return res.status(404).json({ error: 'Agente não encontrado neste tenant' });
    }
    const channel = await channelsRepo.create({
      tenantId,
      agentId: aid,
      name: name || `${type || 'channel'}-${aid.slice(0, 8)}`,
      type: (type || 'api').toString().toLowerCase(),
      status: status || 'offline',
      isActive: true,
      config: config || {},
    });
    res.status(201).json(toChannelApiRow(channel));
  } catch (err) {
    console.error('[global-admin] createChannel:', err.message);
    res.status(500).json({ error: 'Erro ao criar canal' });
  }
}

/**
 * PATCH /api/global-admin/channels/:channelId
 */
export async function updateChannel(req, res) {
  try {
    const { channelId } = req.params;
    const { name, type, config, status, is_active } = req.body || {};
    const channel = await channelsRepo.findById(channelId);
    if (!channel) {
      return res.status(404).json({ error: 'Canal não encontrado' });
    }
    const updated = await channelsRepo.update(channelId, {
      name,
      type,
      config,
      status,
      isActive: is_active,
    });
    res.status(200).json(toChannelApiRow(updated));
  } catch (err) {
    console.error('[global-admin] updateChannel:', err.message);
    res.status(500).json({ error: 'Erro ao atualizar canal' });
  }
}

/**
 * DELETE /api/global-admin/channels/:channelId
 */
export async function deleteChannel(req, res) {
  try {
    const { channelId } = req.params;
    const channel = await channelsRepo.findById(channelId);
    if (!channel) {
      return res.status(404).json({ error: 'Canal não encontrado' });
    }
    await channelsRepo.remove(channelId);
    res.status(204).send();
  } catch (err) {
    console.error('[global-admin] deleteChannel:', err.message);
    res.status(500).json({ error: 'Erro ao remover canal' });
  }
}
