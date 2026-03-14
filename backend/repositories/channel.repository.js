/**
 * Repository: channels – CRUD com escopo por tenant_id.
 * Usado pelas rotas /api/channels (Client App).
 */

import { pool } from '../db/pool.js';

export async function findAllByTenant(tenantId) {
  const { rows } = await pool.query(
    `SELECT id, tenant_id, agent_id, type, instance, is_active AS active, created_at, updated_at
     FROM channels
     WHERE tenant_id = $1
     ORDER BY created_at DESC`,
    [tenantId]
  );
  return rows;
}

export async function findById(id, tenantId) {
  const { rows } = await pool.query(
    `SELECT id, tenant_id, agent_id, type, instance, is_active AS active, created_at, updated_at
     FROM channels
     WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId]
  );
  return rows[0] ?? null;
}

/**
 * @param {Object} data - { tenant_id, agent_id, type, instance?, active? }
 */
export async function create(data) {
  const tenantId = data.tenant_id;
  const agentId = data.agent_id;
  const type = String(data.type || 'api').toLowerCase().trim();
  const instance = data.instance != null ? String(data.instance).trim() : null;
  const active = data.active !== undefined ? Boolean(data.active) : true;
  const name = (instance || type).slice(0, 100);

  const { rows } = await pool.query(
    `INSERT INTO channels (tenant_id, agent_id, name, type, instance, is_active)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, tenant_id, agent_id, type, instance, is_active AS active, created_at, updated_at`,
    [tenantId, agentId, name, type, instance, active]
  );
  return rows[0];
}

/**
 * @param {string} id
 * @param {string} tenantId
 * @param {Object} data - { type?, instance?, agent_id?, active? }
 */
export async function update(id, tenantId, data) {
  const updates = [];
  const values = [];
  let pos = 1;

  if (data.type !== undefined) {
    updates.push(`type = $${pos}`);
    values.push(String(data.type).toLowerCase().trim());
    pos += 1;
  }
  if (data.instance !== undefined) {
    updates.push(`instance = $${pos}`);
    values.push(data.instance != null ? String(data.instance).trim() : null);
    pos += 1;
  }
  if (data.agent_id !== undefined) {
    updates.push(`agent_id = $${pos}`);
    values.push(data.agent_id);
    pos += 1;
  }
  if (data.active !== undefined) {
    updates.push(`is_active = $${pos}`);
    values.push(Boolean(data.active));
    pos += 1;
  }

  if (updates.length === 0) {
    return findById(id, tenantId);
  }

  values.push(id, tenantId);
  const { rows } = await pool.query(
    `UPDATE channels
     SET ${updates.join(', ')}, updated_at = now()
     WHERE id = $${pos} AND tenant_id = $${pos + 1}
     RETURNING id, tenant_id, agent_id, type, instance, is_active AS active, created_at, updated_at`,
    values
  );
  return rows[0] ?? null;
}

export async function deleteById(id, tenantId) {
  const { rowCount } = await pool.query(
    'DELETE FROM channels WHERE id = $1 AND tenant_id = $2',
    [id, tenantId]
  );
  return rowCount > 0;
}
