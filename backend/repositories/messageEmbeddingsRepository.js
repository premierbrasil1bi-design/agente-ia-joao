/**
 * Repositório: message_embeddings – vetores de mensagens para busca semântica (pgvector).
 */

import { pool } from '../db/pool.js';

function embeddingToVectorStr(embedding) {
  if (Array.isArray(embedding)) {
    return '[' + embedding.join(',') + ']';
  }
  if (typeof embedding === 'string' && embedding.startsWith('[')) {
    return embedding;
  }
  return '[]';
}

export async function saveEmbedding({ messageId, agentId, senderId, content, embedding }) {
  if (!messageId || !agentId || senderId == null || content == null) {
    return null;
  }
  const vectorStr = embeddingToVectorStr(embedding);
  const { rows } = await pool.query(
    `INSERT INTO message_embeddings (message_id, agent_id, sender_id, content, embedding)
     VALUES ($1, $2, $3, $4, $5::vector)
     RETURNING id, message_id, agent_id, sender_id, content, created_at`,
    [messageId, agentId, String(senderId).trim(), String(content).slice(0, 10000), vectorStr]
  );
  return rows[0] ?? null;
}

/**
 * Return rows with content and distance, ordered by cosine distance (closest first).
 * @param {string} agentId
 * @param {string} senderId
 * @param {number[]|string} embedding - vector(1536)
 * @param {number} limit
 * @returns {Promise<Array<{ content: string }>>}
 */
export async function searchRelevantEmbeddings(agentId, senderId, embedding, limit = 5) {
  if (!agentId || senderId == null) {
    return [];
  }
  const vectorStr = embeddingToVectorStr(embedding);
  const cappedLimit = Math.min(Math.max(1, limit), 20);
  const { rows } = await pool.query(
    `SELECT content
     FROM message_embeddings
     WHERE agent_id = $1 AND sender_id = $2 AND embedding IS NOT NULL
     ORDER BY embedding <=> $3::vector
     LIMIT $4`,
    [agentId, String(senderId).trim(), vectorStr, cappedLimit]
  );
  return rows;
}
