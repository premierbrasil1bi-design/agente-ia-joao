import { pool } from '../db/pool.js';

export const createTenant = async (data) => {
  const name = String(data?.name ?? data?.nome_empresa ?? '').trim() || 'Unnamed';
  const slug = data?.slug ?? null;
  const plan = data?.plan ?? data?.plan_id ?? null;
  const max_agents = data?.max_agents ?? null;
  const max_messages = data?.max_messages ?? null;
  const active = data?.active !== undefined ? Boolean(data.active) : true;

  const result = await pool.query(
    `
    INSERT INTO tenants (
      name,
      slug,
      plan,
      max_agents,
      max_messages,
      active
    )
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *;
    `,
    [name, slug, plan, max_agents, max_messages, active]
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

  const result = await pool.query(
    `
    UPDATE tenants
    SET
      name = COALESCE($1, name),
      slug = COALESCE($2, slug),
      plan = COALESCE($3, plan),
      max_agents = COALESCE($4, max_agents),
      max_messages = COALESCE($5, max_messages),
      active = COALESCE($6, active)
    WHERE id = $7
    RETURNING *;
    `,
    [name || null, slug ?? null, plan ?? null, max_agents ?? null, max_messages ?? null, active ?? null, id]
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

