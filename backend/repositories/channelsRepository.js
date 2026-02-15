/**
 * Repositório: channels – acesso ao banco (Neon).
 * Canais por agente (WhatsApp, Instagram, Web, API).
 */

import { query } from '../db/connection.js';

export async function findByAgentId(agentId) {
  const { rows } = await query(
    `SELECT id, agent_id, name, type, status, is_active, message_count, created_at, updated_at
     FROM channels WHERE agent_id = $1 ORDER BY name`,
    [agentId]
  );
  return rows;
}

export async function findById(id) {
  const { rows } = await query(
    'SELECT id, agent_id, name, type, status, is_active, message_count, created_at, updated_at FROM channels WHERE id = $1',
    [id]
  );
  return rows[0] ?? null;
}

export async function create({ agentId, name, type, status = 'offline', isActive = true }) {
  const { rows } = await query(
    'INSERT INTO channels (agent_id, name, type, status, is_active) VALUES ($1, $2, $3, $4, $5) RETURNING id, agent_id, name, type, status, is_active, message_count, created_at, updated_at',
    [agentId, name, type, status, isActive]
  );
  return rows[0];
}

export async function update(id, { name, type, status, isActive }) {
  const { rows } = await query(
    `UPDATE channels SET
      name = COALESCE($2, name),
      type = COALESCE($3, type),
      status = COALESCE($4, status),
      is_active = COALESCE($5, is_active)
    WHERE id = $1 RETURNING id, agent_id, name, type, status, is_active, message_count, created_at, updated_at`,
    [id, name ?? null, type ?? null, status ?? null, isActive ?? null]
  );
  return rows[0] ?? null;
}

export async function incrementMessageCount(id) {
  await query('UPDATE channels SET message_count = message_count + 1 WHERE id = $1', [id]);
}

export async function remove(id) {
  const { rowCount } = await query('DELETE FROM channels WHERE id = $1', [id]);
  return rowCount > 0;
}
