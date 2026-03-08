/**
 * Repositório: user_memory – fatos persistentes por agente e usuário (memória de longo prazo).
 */

import { pool } from '../db/pool.js';

export async function getFacts(agentId, senderId) {
  if (!agentId || senderId == null || String(senderId).trim() === '') {
    return [];
  }
  const { rows } = await pool.query(
    `SELECT id, agent_id, sender_id, memory_key, memory_value, confidence, created_at, updated_at
     FROM user_memory
     WHERE agent_id = $1 AND sender_id = $2
     ORDER BY updated_at DESC`,
    [agentId, String(senderId).trim()]
  );
  return rows;
}

export async function storeFact(agentId, senderId, key, value, confidence = 0.5) {
  if (!agentId || senderId == null || key == null || key === '') {
    return null;
  }
  const conf = Number(confidence);
  const safeConf = Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0.5;
  const { rows } = await pool.query(
    `INSERT INTO user_memory (agent_id, sender_id, memory_key, memory_value, confidence)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (agent_id, sender_id, memory_key)
     DO UPDATE SET memory_value = EXCLUDED.memory_value, confidence = EXCLUDED.confidence, updated_at = now()
     RETURNING id, agent_id, sender_id, memory_key, memory_value, confidence, created_at, updated_at`,
    [agentId, String(senderId).trim(), String(key).trim().slice(0, 255), String(value ?? '').trim(), safeConf]
  );
  return rows[0] ?? null;
}

export async function updateFact(agentId, senderId, key, value, confidence = 0.5) {
  if (!agentId || senderId == null || key == null || key === '') {
    return null;
  }
  const conf = Number(confidence);
  const safeConf = Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0.5;
  const { rows } = await pool.query(
    `UPDATE user_memory
     SET memory_value = $4, confidence = $5, updated_at = now()
     WHERE agent_id = $1 AND sender_id = $2 AND memory_key = $3
     RETURNING id, agent_id, sender_id, memory_key, memory_value, confidence, created_at, updated_at`,
    [agentId, String(senderId).trim(), String(key).trim().slice(0, 255), String(value ?? '').trim(), safeConf]
  );
  return rows[0] ?? null;
}
