/**
 * Repositório: messages – acesso ao banco (Neon).
 * Histórico de mensagens por agente e canal.
 */

import { query } from '../db/connection.js';

export async function findByAgentId(agentId, { channelId = null, limit = 100, offset = 0 } = {}) {
  if (channelId) {
    const { rows } = await query(
      `SELECT id, agent_id, channel_id, role, content, created_at
       FROM messages WHERE agent_id = $1 AND channel_id = $2 ORDER BY created_at DESC LIMIT $3 OFFSET $4`,
      [agentId, channelId, limit, offset]
    );
    return rows;
  }
  const { rows } = await query(
    `SELECT id, agent_id, channel_id, role, content, created_at
     FROM messages WHERE agent_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [agentId, limit, offset]
  );
  return rows;
}

export async function create({ agentId, channelId, role, content }) {
  const { rows } = await query(
    'INSERT INTO messages (agent_id, channel_id, role, content) VALUES ($1, $2, $3, $4) RETURNING id, agent_id, channel_id, role, content, created_at',
    [agentId, channelId ?? null, role, content]
  );
  return rows[0];
}

export async function countByAgentId(agentId, channelId = null) {
  if (channelId) {
    const { rows } = await query(
      'SELECT COUNT(*)::int AS total FROM messages WHERE agent_id = $1 AND channel_id = $2',
      [agentId, channelId]
    );
    return rows[0].total;
  }
  const { rows } = await query(
    'SELECT COUNT(*)::int AS total FROM messages WHERE agent_id = $1',
    [agentId]
  );
  return rows[0].total;
}
