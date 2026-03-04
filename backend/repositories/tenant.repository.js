
import { pool } from '../db/pool.js';

export const createTenant = async (data) => {
  const {
    name,
    slug,
    plan_id,
    max_agents,
    max_messages,
    active,
  } = data;

  const result = await pool.query(
    `
    INSERT INTO tenants (
      id,
      name,
      slug,
      plan_id,
      max_agents,
      max_messages,
      active
    )
    VALUES (
      gen_random_uuid(),
      $1,
      $2,
      $3,
      $4,
      $5,
      $6
    )
    RETURNING *;
    `,
    [name, slug, plan_id, max_agents, max_messages, active]
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
  const {
    name,
    plan_id,
    max_agents,
    max_messages,
    active,
  } = data;

  const result = await pool.query(
    `
    UPDATE tenants
    SET
      name = COALESCE($1, name),
      plan_id = COALESCE($2, plan_id),
      max_agents = COALESCE($3, max_agents),
      max_messages = COALESCE($4, max_messages),
      active = COALESCE($5, active),
      updated_at = now()
    WHERE id = $6
    RETURNING *;
    `,
    [
      name ?? null,
      plan_id ?? null,
      max_agents ?? null,
      max_messages ?? null,
      active ?? null,
      id,
    ]
  );

  return result.rows[0] ?? null;
};

export const deleteTenant = async (id) => {
  await pool.query(
    'DELETE FROM tenants WHERE id = $1',
    [id]
  );
};

