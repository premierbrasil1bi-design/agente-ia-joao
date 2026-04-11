import { getTenantById, updateTenant, suspendTenant } from '../repositories/tenant.repository.js';
import { toTenantApiRow } from '../utils/tenantMapper.js';
import { invalidateTenantLimitsCache } from '../services/tenantLimits.service.js';

/**
 * PATCH /api/global-admin/tenants/:tenantId
 * Allow editing: name, slug, plan, status (status -> active)
 */
export async function updateTenantHandler(req, res) {
  try {
    const { tenantId } = req.params;
    const tenant = await getTenantById(tenantId);
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant não encontrado' });
    }
    const updated = await updateTenant(tenantId, req.body);
    invalidateTenantLimitsCache(tenantId);
    const t = toTenantApiRow({
      ...updated,
      max_agents: updated.max_agents ?? 0,
      max_messages: updated.max_messages ?? 0,
    });
    res.status(200).json({
      id: t.id,
      nome_empresa: t.nome_empresa,
      slug: t.slug,
      plan: t.plan ?? 'free',
      status: t.status,
      active: t.active,
      name: t.name,
      max_agents: t.max_agents,
      max_messages: t.max_messages,
      allowed_providers: Array.isArray(t.allowed_providers) ? t.allowed_providers : [],
      created_at: t.created_at,
    });
  } catch (err) {
    console.error('[global-admin] updateTenant:', err.message);
    res.status(500).json({ error: 'Erro ao atualizar tenant' });
  }
}

/**
 * PATCH /api/global-admin/tenants/:tenantId/suspend
 */
export async function suspendTenantHandler(req, res) {
  try {
    const { tenantId } = req.params;
    const tenant = await getTenantById(tenantId);
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant não encontrado' });
    }
    const updated = await suspendTenant(tenantId);
    invalidateTenantLimitsCache(tenantId);
    const t = toTenantApiRow({
      ...updated,
      max_agents: updated.max_agents ?? 0,
      max_messages: updated.max_messages ?? 0,
    });
    res.status(200).json({
      id: t.id,
      nome_empresa: t.nome_empresa,
      slug: t.slug,
      plan: t.plan ?? 'free',
      status: 'inativo',
      active: false,
      name: t.name,
      max_agents: t.max_agents,
      max_messages: t.max_messages,
      allowed_providers: Array.isArray(t.allowed_providers) ? t.allowed_providers : [],
      created_at: t.created_at,
    });
  } catch (err) {
    console.error('[global-admin] suspendTenant:', err.message);
    res.status(500).json({ error: 'Erro ao suspender tenant' });
  }
}
