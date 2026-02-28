
import { pool } from '../db/pool.js';

export async function createTenant(data) {
  const { name, slug, plan, max_agents, max_messages, status } = data;
  const result = await pool.query(
    `
    INSERT INTO tenants (name, slug, plan, max_agents, max_messages, status)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
    `,
    [name, slug, plan, max_agents, max_messages, status]
  );
  return result.rows[0];
}

export async function getAllTenants() {
  const result = await pool.query(
    'SELECT * FROM tenants ORDER BY created_at DESC'
  );
  return result.rows;
}

export async function getTenantById(id) {
  const result = await pool.query(
    'SELECT * FROM tenants WHERE id = $1',
    [id]
  );
  return result.rows[0];
}

export async function updateTenant(id, data) {
  const { name, plan, max_agents, max_messages, status } = data;
  const result = await pool.query(
    `
    UPDATE tenants
    SET name = $1,
        plan = $2,
        max_agents = $3,
        max_messages = $4,
        status = $5,
        updated_at = now()
    WHERE id = $6
    RETURNING *
    `,
    [name, plan, max_agents, max_messages, status, id]
  );
  return result.rows[0];
}

export async function deleteTenant(id) {
  await pool.query(
    'DELETE FROM tenants WHERE id = $1',
    [id]
  );
}


