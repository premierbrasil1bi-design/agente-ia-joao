/**
 * Repositório: usage_logs – registro de uso por canal (mensagens, tokens, custo).
 */

import pool from '../db/connection.js';

export async function create({
  clientId,
  agentId,
  channelId,
  channelType,
  messagesSent = 0,
  messagesReceived = 0,
  tokens = 0,
  estimatedCost = 0,
}) {
  const insertResult = await pool.query(
    `INSERT INTO usage_logs (
      client_id, agent_id, channel_id, channel_type,
      messages_sent, messages_received, tokens, estimated_cost
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id, client_id, agent_id, channel_id, channel_type,
      messages_sent, messages_received, tokens, estimated_cost, recorded_at`,
    [
      clientId ?? null,
      agentId ?? null,
      channelId ?? null,
      channelType,
      messagesSent,
      messagesReceived,
      tokens,
      estimatedCost,
    ]
  );
  return insertResult.rows[0];
}
