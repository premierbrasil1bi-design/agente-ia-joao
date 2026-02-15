/**
 * Repositório: prompts – acesso ao banco (Neon).
 * Prompts versionados: base (channel_id NULL) e por canal.
 */

import { query } from '../db/connection.js';

export async function findByAgentId(agentId) {
  const { rows } = await query(
    `SELECT id, agent_id, channel_id, content, version, created_at, updated_at
     FROM prompts WHERE agent_id = $1 ORDER BY channel_id NULLS FIRST, version DESC`,
    [agentId]
  );
  return rows;
}

export async function findBaseByAgentId(agentId) {
  const { rows } = await query(
    'SELECT id, agent_id, channel_id, content, version, created_at, updated_at FROM prompts WHERE agent_id = $1 AND channel_id IS NULL ORDER BY version DESC LIMIT 1',
    [agentId]
  );
  return rows[0] ?? null;
}

export async function findByChannelId(agentId, channelId) {
  const { rows } = await query(
    'SELECT id, agent_id, channel_id, content, version, created_at, updated_at FROM prompts WHERE agent_id = $1 AND channel_id = $2 ORDER BY version DESC LIMIT 1',
    [agentId, channelId]
  );
  return rows[0] ?? null;
}

export async function create({ agentId, channelId, content, version = 1 }) {
  const { rows } = await query(
    'INSERT INTO prompts (agent_id, channel_id, content, version) VALUES ($1, $2, $3, $4) RETURNING id, agent_id, channel_id, content, version, created_at, updated_at',
    [agentId, channelId ?? null, content, version]
  );
  return rows[0];
}

export async function findById(id) {
  const { rows } = await query(
    'SELECT id, agent_id, channel_id, content, version, created_at, updated_at FROM prompts WHERE id = $1',
    [id]
  );
  return rows[0] ?? null;
}

export async function update(id, { content, version }) {
  const { rows } = await query(
    'UPDATE prompts SET content = COALESCE($2, content), version = COALESCE($3, version) WHERE id = $1 RETURNING id, agent_id, channel_id, content, version, created_at, updated_at',
    [id, content ?? null, version ?? null]
  );
  return rows[0] ?? null;
}

export async function remove(id) {
  const { rowCount } = await query('DELETE FROM prompts WHERE id = $1', [id]);
  return rowCount > 0;
}
