/**
 * Repositório: messages – acesso ao banco (Neon).
 * Histórico de mensagens por agente e canal.
 */

import { pool } from '../db/pool.js';

export async function findByAgentId(agentId, { channelId = null, limit = 100, offset = 0 } = {}) {
  if (channelId) {
    const { rows } = await pool.query(
      `SELECT id, agent_id, channel_id, role, content, created_at
       FROM messages WHERE agent_id = $1 AND channel_id = $2 ORDER BY created_at DESC LIMIT $3 OFFSET $4`,
      [agentId, channelId, limit, offset]
    );
    return rows;
  }
  const { rows } = await pool.query(
    `SELECT id, agent_id, channel_id, role, content, created_at
     FROM messages WHERE agent_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [agentId, limit, offset]
  );
  return rows;
}

export async function create({ agentId, channelId, role, content, senderId = null }) {
  const { rows } = await pool.query(
    `INSERT INTO messages (agent_id, channel_id, role, content, sender_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING id, agent_id, channel_id, role, content, created_at`,
    [agentId, channelId ?? null, role, content, senderId ?? null]
  );
  return rows[0];
}

/**
 * Last N messages for a conversation (agent + channel + sender), newest first.
 * Used by conversationMemoryService for AI context.
 */
export async function findRecentForConversation(agentId, channelId, senderId, limit = 10) {
  if (!agentId || senderId == null || String(senderId).trim() === '') {
    return [];
  }
  const { rows } = await pool.query(
    `SELECT id, agent_id, channel_id, role, content, created_at
     FROM messages
     WHERE agent_id = $1 AND sender_id = $2
       AND (channel_id = $3 OR ($3::uuid IS NULL AND channel_id IS NULL))
     ORDER BY created_at DESC
     LIMIT $4`,
    [agentId, String(senderId).trim(), channelId ?? null, Math.min(Math.max(1, limit), 50)]
  );
  return rows;
}

export async function countByAgentId(agentId, channelId = null) {
  if (channelId) {
    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS total FROM messages WHERE agent_id = $1 AND channel_id = $2',
      [agentId, channelId]
    );
    return rows[0].total;
  }
  const { rows } = await pool.query(
    'SELECT COUNT(*)::int AS total FROM messages WHERE agent_id = $1',
    [agentId]
  );
  return rows[0].total;
}
