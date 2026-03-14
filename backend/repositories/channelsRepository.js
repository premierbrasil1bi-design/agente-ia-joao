/**
 * Repositório: channels – acesso ao banco (Neon).
 * Canais por agente (WhatsApp, Instagram, Web, API).
 */


import { pool } from '../db/pool.js';


export async function findByAgentId(agentId) {
  const { rows } = await pool.query(
    `SELECT id, tenant_id, agent_id, name, type, status, is_active, message_count, config, created_at, updated_at
     FROM channels WHERE agent_id = $1 ORDER BY name`,
    [agentId]
  );
  return rows;
}

/** List channels by tenant_id (SaaS admin). */
export async function findByTenantId(tenantId) {
  const { rows } = await pool.query(
    `SELECT id, tenant_id, agent_id, name, type, status, is_active, message_count, config, created_at, updated_at
     FROM channels WHERE tenant_id = $1 ORDER BY name`,
    [tenantId]
  );
  return rows;
}

/** Find by id and tenant_id (ensure tenant scope). */
export async function findByIdAndTenantId(id, tenantId) {
  const { rows } = await pool.query(
    `SELECT id, tenant_id, agent_id, name, type, status, is_active, message_count, config, created_at, updated_at
     FROM channels WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId]
  );
  return rows[0] ?? null;
}

/**
 * Find channel by type and instance (for agent router – instance → agent resolution).
 * Requires channels.instance column (migration 001_add_channels_instance.sql).
 */
export async function findByTypeAndInstance(type, instance) {
  if (!type || instance == null || instance === '') {
    return null;
  }
  const { rows } = await pool.query(
    `SELECT id, agent_id, name, type, status, is_active, instance
     FROM channels WHERE type = $1 AND instance = $2 AND is_active = true LIMIT 1`,
    [String(type).toLowerCase().trim(), String(instance).trim()]
  );
  return rows[0] ?? null;
}


export async function findById(id) {
  const { rows } = await pool.query(
    'SELECT id, tenant_id, agent_id, name, type, status, is_active, message_count, config, created_at, updated_at FROM channels WHERE id = $1',
    [id]
  );
  return rows[0] ?? null;
}


export async function create({ tenantId, agentId, name, type, status, isActive, config }) {
  let tid = tenantId;
  if (tid == null && agentId) {
    const agentRow = await pool.query('SELECT tenant_id FROM agents WHERE id = $1', [agentId]).then(r => r.rows[0]);
    tid = agentRow?.tenant_id ?? null;
  }
  const { rows } = await pool.query(
    `INSERT INTO channels (tenant_id, agent_id, name, type, status, is_active, config)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::jsonb, '{}'))
     RETURNING id, tenant_id, agent_id, name, type, status, is_active, message_count, config, created_at, updated_at`,
    [tid, agentId, name, type, status ?? 'offline', isActive !== false, config ? JSON.stringify(config) : null]
  );
  return rows[0];
}


export async function update(id, { name, type, status, isActive, config }) {
  const updates = ['name = COALESCE($2, name)', 'type = COALESCE($3, type)', 'status = COALESCE($4, status)', 'is_active = COALESCE($5, is_active)'];
  const values = [id, name ?? null, type ?? null, status ?? null, isActive ?? null];
  if (config !== undefined) {
    updates.push('config = COALESCE($6::jsonb, config)');
    values.push(config ? JSON.stringify(config) : null);
  }
  const { rows } = await pool.query(
    `UPDATE channels SET ${updates.join(', ')} WHERE id = $1 RETURNING id, tenant_id, agent_id, name, type, status, is_active, message_count, config, created_at, updated_at`,
    values
  );
  return rows[0] ?? null;
}


export async function incrementMessageCount(id) {
  await pool.query('UPDATE channels SET message_count = message_count + 1 WHERE id = $1', [id]);
}


export async function remove(id) {
  const { rowCount } = await pool.query('DELETE FROM channels WHERE id = $1', [id]);
  return rowCount > 0;
}
