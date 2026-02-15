/**
 * Repositório: costs – acesso ao banco (Neon).
 * Custos por agente/canal e período (dia/semana/mês).
 */

import { query } from '../db/connection.js';

export async function findByAgentId(agentId, { channelId = null, period = null, from = null, to = null } = {}) {
  let sql = 'SELECT id, agent_id, channel_id, amount, period, recorded_at, created_at FROM costs WHERE agent_id = $1';
  const params = [agentId];
  let i = 2;
  if (channelId) {
    sql += ` AND channel_id = $${i}`;
    params.push(channelId);
    i++;
  }
  if (period) {
    sql += ` AND period = $${i}`;
    params.push(period);
    i++;
  }
  if (from) {
    sql += ` AND recorded_at >= $${i}`;
    params.push(from);
    i++;
  }
  if (to) {
    sql += ` AND recorded_at <= $${i}`;
    params.push(to);
  }
  sql += ' ORDER BY recorded_at DESC';
  const { rows } = await query(sql, params);
  return rows;
}

export async function getTotals(agentId = null, { period = null, from = null, to = null } = {}) {
  let sql = 'SELECT agent_id, channel_id, period, SUM(amount::numeric) AS total FROM costs WHERE 1=1';
  const params = [];
  let i = 1;
  if (agentId) {
    sql += ` AND agent_id = $${i}`;
    params.push(agentId);
    i++;
  }
  if (period) {
    sql += ` AND period = $${i}`;
    params.push(period);
    i++;
  }
  if (from) {
    sql += ` AND recorded_at >= $${i}`;
    params.push(from);
    i++;
  }
  if (to) {
    sql += ` AND recorded_at <= $${i}`;
    params.push(to);
  }
  sql += ' GROUP BY agent_id, channel_id, period';
  const { rows } = await query(sql, params);
  return rows;
}

export async function create({ agentId, channelId, amount, period, recordedAt }) {
  const { rows } = await query(
    'INSERT INTO costs (agent_id, channel_id, amount, period, recorded_at) VALUES ($1, $2, $3, $4, $5) RETURNING id, agent_id, channel_id, amount, period, recorded_at, created_at',
    [agentId, channelId ?? null, amount, period, recordedAt]
  );
  return rows[0];
}

export async function remove(id) {
  const { rowCount } = await query('DELETE FROM costs WHERE id = $1', [id]);
  return rowCount > 0;
}
