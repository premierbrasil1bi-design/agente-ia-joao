import { pool } from '../db/pool.js';
import { getTenantById } from '../repositories/tenant.repository.js';
import { findByTenantId } from '../repositories/adminsRepository.js';

/**
 * GET /api/global-admin/tenants/:tenantId/users
 * Uses existing admins table filtered by tenant_id.
 */
export async function listUsers(req, res) {
  try {
    const { tenantId } = req.params;
    const tenant = await getTenantById(tenantId);
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant não encontrado' });
    }
    const rows = await findByTenantId(tenantId);
    const list = rows.map((r) => ({
      id: r.id,
      tenant_id: r.tenant_id,
      email: r.email,
      name: r.name ?? null,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));
    res.status(200).json(list);
  } catch (err) {
    console.error('[global-admin] listUsers:', err.message);
    res.status(500).json({ error: 'Erro ao listar usuários' });
  }
}

/**
 * GET /api/global-admin/tenants/:tenantId/usage
 * Returns: messages_count, agents_count, channels_count, current_plan_limit
 */
export async function getUsage(req, res) {
  try {
    const { tenantId } = req.params;
    const tenant = await getTenantById(tenantId);
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant não encontrado' });
    }
    const [messagesRes, agentsRes, channelsRes] = await Promise.all([
      pool.query(
        'SELECT COUNT(*)::int AS c FROM messages WHERE tenant_id = $1',
        [tenantId]
      ),
      pool.query(
        'SELECT COUNT(*)::int AS c FROM agents WHERE tenant_id = $1',
        [tenantId]
      ),
      pool.query(
        'SELECT COUNT(*)::int AS c FROM channels WHERE tenant_id = $1',
        [tenantId]
      ),
    ]);
    const messages_count = messagesRes.rows[0]?.c ?? 0;
    const agents_count = agentsRes.rows[0]?.c ?? 0;
    const channels_count = channelsRes.rows[0]?.c ?? 0;
    const current_plan_limit = {
      max_agents: tenant.max_agents ?? 0,
      max_messages: tenant.max_messages ?? 0,
      plan: tenant.plan ?? 'free',
    };
    res.status(200).json({
      messages_count,
      agents_count,
      channels_count,
      current_plan_limit,
    });
  } catch (err) {
    console.error('[global-admin] getUsage:', err.message);
    res.status(500).json({ error: 'Erro ao buscar uso' });
  }
}

/**
 * GET /api/global-admin/tenants/:tenantId/logs
 * Filter logs by tenant_id (usage_logs as activity log).
 */
export async function getLogs(req, res) {
  try {
    const { tenantId } = req.params;
    const tenant = await getTenantById(tenantId);
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant não encontrado' });
    }
    const { rows } = await pool.query(
      `SELECT id, tenant_id, agent_id, channel_id, channel_type, messages_sent, messages_received, tokens, estimated_cost, recorded_at, created_at
       FROM usage_logs
       WHERE tenant_id = $1
       ORDER BY recorded_at DESC
       LIMIT 200`,
      [tenantId]
    ).catch(() => ({ rows: [] }));
    res.status(200).json(rows);
  } catch (err) {
    console.error('[global-admin] getLogs:', err.message);
    res.status(500).json({ error: 'Erro ao buscar logs' });
  }
}

/**
 * GET /api/global-admin/tenants/:tenantId/billing
 * Billing info for tenant: plan and usage.
 */
export async function getBilling(req, res) {
  try {
    const { tenantId } = req.params;
    const tenant = await getTenantById(tenantId);
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant não encontrado' });
    }
    const [usageRows] = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM messages WHERE tenant_id = $1) AS messages_count,
         (SELECT COUNT(*)::int FROM agents WHERE tenant_id = $1) AS agents_count`,
      [tenantId]
    ).then((r) => [r.rows[0]]).catch(() => [{ messages_count: 0, agents_count: 0 }]);
    const messages_count = Number(usageRows?.messages_count ?? 0);
    const agents_count = Number(usageRows?.agents_count ?? 0);
    res.status(200).json({
      tenant_id: tenantId,
      plan: tenant.plan ?? 'free',
      max_agents: tenant.max_agents ?? 0,
      max_messages: tenant.max_messages ?? 0,
      messages_count,
      agents_count,
      active: tenant.active !== false,
    });
  } catch (err) {
    console.error('[global-admin] getBilling:', err.message);
    res.status(500).json({ error: 'Erro ao buscar billing' });
  }
}
