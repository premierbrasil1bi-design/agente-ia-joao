import { pool } from '../db/pool.js';
import { sanitizeAllowedProviders } from '../utils/tenantAllowedProviders.js';

export const createTenant = async (data) => {
  const name = String(data?.name ?? data?.nome_empresa ?? '').trim() || 'Unnamed';
  const slug = data?.slug ?? null;
  const plan = data?.plan ?? data?.plan_id ?? null;
  const max_agents = data?.max_agents ?? null;
  const max_messages = data?.max_messages ?? null;
  const active = data?.active !== undefined ? Boolean(data.active) : true;
  const allowedProviders = sanitizeAllowedProviders(data?.allowed_providers);

  const result = await pool.query(
    `
    INSERT INTO tenants (
      name,
      slug,
      plan,
      max_agents,
      max_messages,
      active,
      allowed_providers
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
    RETURNING *;
    `,
    [name, slug, plan, max_agents, max_messages, active, JSON.stringify(allowedProviders)]
  );

  return result.rows[0];
};

export const getAllTenants = async () => {
  const result = await pool.query(
    'SELECT * FROM tenants ORDER BY created_at DESC'
  );
  return result.rows;
};

export const getTenantById = async (id) => {
  const result = await pool.query(
    'SELECT * FROM tenants WHERE id = $1',
    [id]
  );
  return result.rows[0] ?? null;
};

/**
 * Se o ciclo (desde billing_cycle_start ou created_at) expirou, zera messages_used_current_period e renova billing_cycle_start.
 * @param {string} tenantId
 * @param {number} [cycleDays=30]
 * @returns {Promise<object|null>}
 */
export async function refreshTenantAfterBillingCycleCheck(tenantId, cycleDays = 30) {
  const days = Math.max(1, Number(cycleDays) || 30);
  const r = await pool.query(
    `
    UPDATE tenants
    SET
      messages_used_current_period = 0,
      billing_cycle_start = NOW(),
      updated_at = NOW()
    WHERE id = $1::uuid
      AND COALESCE(billing_cycle_start, created_at) < NOW() - ($2::int * INTERVAL '1 day')
    RETURNING *;
    `,
    [tenantId, days]
  );
  if (r.rows[0]) return r.rows[0];
  return getTenantById(tenantId);
}

/**
 * Consome 1 unidade de quota de mensagens de forma atômica (sem race entre checagem e incremento).
 * @param {string} tenantId
 * @returns {Promise<{ id: string, max_messages: number | null, messages_used_current_period: number } | null>}
 */
export async function tryConsumeTenantMessageQuota(tenantId) {
  const r = await pool.query(
    `
    UPDATE tenants
    SET
      messages_used_current_period = COALESCE(messages_used_current_period, 0) + 1,
      updated_at = NOW()
    WHERE id = $1::uuid
      AND (
        max_messages IS NULL
        OR max_messages <= 0
        OR messages_used_current_period < max_messages
      )
    RETURNING id, max_messages, messages_used_current_period;
    `,
    [tenantId]
  );
  return r.rows[0] ?? null;
}

/**
 * Reverte uma unidade consumida quando o envio falhou após tryConsume (mantém contagem alinhada a entregas tentadas com sucesso).
 * @param {string} tenantId
 */
export async function refundTenantMessageQuota(tenantId) {
  await pool.query(
    `
    UPDATE tenants
    SET
      messages_used_current_period = GREATEST(0, COALESCE(messages_used_current_period, 0) - 1),
      updated_at = NOW()
    WHERE id = $1::uuid;
    `,
    [tenantId]
  );
}

export const updateTenant = async (id, data) => {
  const name = data?.name != null ? String(data.name).trim() : null;
  const slug = data?.slug != null ? String(data.slug).trim() : null;
  const plan = data?.plan ?? data?.plan_id ?? null;
  const max_agents = data?.max_agents ?? null;
  const max_messages = data?.max_messages ?? null;
  let active = data?.active;
  if (data?.status !== undefined && data?.status !== null) {
    const s = String(data.status).toLowerCase();
    active = s === 'ativo' || s === 'active' || s === '1' || s === 'true';
  }
  if (active === undefined) active = null;
  const allowedProviders =
    data?.allowed_providers !== undefined ? sanitizeAllowedProviders(data.allowed_providers) : undefined;

  const result = await pool.query(
    `
    UPDATE tenants
    SET
      name = COALESCE($1, name),
      slug = COALESCE($2, slug),
      plan = COALESCE($3, plan),
      max_agents = COALESCE($4, max_agents),
      max_messages = COALESCE($5, max_messages),
      active = COALESCE($6, active),
      allowed_providers = COALESCE($7::jsonb, allowed_providers)
    WHERE id = $8
    RETURNING *;
    `,
    [
      name || null,
      slug ?? null,
      plan ?? null,
      max_agents ?? null,
      max_messages ?? null,
      active ?? null,
      allowedProviders !== undefined ? JSON.stringify(allowedProviders) : null,
      id,
    ]
  );

  return result.rows[0] ?? null;
};

/** Set tenant to suspended (active = false). */
export const suspendTenant = async (id) => {
  const result = await pool.query(
    `UPDATE tenants SET active = false WHERE id = $1 RETURNING *`,
    [id]
  );
  return result.rows[0] ?? null;
};

export const deleteTenant = async (id) => {
  await pool.query(
    'DELETE FROM tenants WHERE id = $1',
    [id]
  );
};

