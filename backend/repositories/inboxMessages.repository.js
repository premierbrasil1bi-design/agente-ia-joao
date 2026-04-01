import { pool } from '../db/pool.js';

export async function listConversationsByTenant(tenantId, channelId = null) {
  const params = [tenantId];
  let where = 'm.tenant_id = $1 AND m.sender_id IS NOT NULL AND m.sender_id <> \'\'';
  if (channelId) {
    params.push(channelId);
    where += ` AND m.channel_id = $${params.length}`;
  }
  const { rows } = await pool.query(
    `SELECT
       m.channel_id,
       c.type AS channel_type,
       m.sender_id AS contact,
       MAX(m.created_at) AS last_timestamp,
       (ARRAY_AGG(m.content ORDER BY m.created_at DESC))[1] AS last_message,
      (ARRAY_AGG(m.role ORDER BY m.created_at DESC))[1] AS last_role,
      (ARRAY_AGG(m.status ORDER BY m.created_at DESC))[1] AS last_status
     FROM messages m
     LEFT JOIN channels c ON c.id = m.channel_id
     WHERE ${where}
     GROUP BY m.channel_id, c.type, m.sender_id
     ORDER BY MAX(m.created_at) DESC`,
    params
  );
  return rows.map((r) => ({
    channel_id: r.channel_id,
    channel_type: r.channel_type,
    contact: r.contact,
    last_message: r.last_message,
    timestamp: r.last_timestamp,
    status: r.last_status || 'SENT',
    direction: String(r.last_role || '').toLowerCase() === 'user' ? 'inbound' : 'outbound',
  }));
}

export async function listMessagesByConversation({ tenantId, channelId, contact, limit = 100, offset = 0 }) {
  const { rows } = await pool.query(
    `SELECT m.id, m.tenant_id, m.channel_id, c.type AS channel_type, m.sender_id AS contact, m.role, m.content, m.created_at,
            m.status, m.provider, m.external_message_id, m.conversation_id, m.status_updated_at
     FROM messages m
     LEFT JOIN channels c ON c.id = m.channel_id
     WHERE tenant_id = $1
       AND channel_id = $2
       AND sender_id = $3
     ORDER BY created_at DESC
     LIMIT $4 OFFSET $5`,
    [tenantId, channelId, contact, limit, offset]
  );
  return rows.reverse().map((r) => ({
    id: r.id,
    tenant_id: r.tenant_id,
    channel_id: r.channel_id,
    channel_type: r.channel_type,
    contact: r.contact,
    direction: String(r.role || '').toLowerCase() === 'user' ? 'inbound' : 'outbound',
    content: r.content,
    timestamp: r.created_at,
    status: r.status || 'SENT',
    provider: r.provider || null,
    external_message_id: r.external_message_id || null,
    conversation_id: r.conversation_id || null,
    status_updated_at: r.status_updated_at || null,
  }));
}

export async function createMessage({
  tenantId,
  agentId,
  channelId,
  contact,
  direction,
  content,
  timestamp = new Date().toISOString(),
  status = 'DELIVERED',
  conversationId = null,
  provider = null,
  externalMessageId = null,
  statusUpdatedAt = new Date().toISOString(),
}) {
  const role = direction === 'inbound' ? 'user' : 'assistant';
  const { rows } = await pool.query(
    `INSERT INTO messages (tenant_id, agent_id, channel_id, sender_id, role, content, created_at, conversation_id, provider, external_message_id, status, status_updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING id, tenant_id, channel_id, sender_id AS contact, role, content, created_at, conversation_id, provider, external_message_id, status, status_updated_at`,
    [tenantId, agentId, channelId, contact, role, content, timestamp, conversationId, provider, externalMessageId, status, statusUpdatedAt]
  );
  const m = rows[0];
  return {
    id: m.id,
    tenant_id: m.tenant_id,
    channel_id: m.channel_id,
    contact: m.contact,
    direction,
    content: m.content,
    timestamp: m.created_at,
    status,
    conversation_id: m.conversation_id || null,
    provider: m.provider || null,
    external_message_id: m.external_message_id || null,
    status_updated_at: m.status_updated_at || null,
  };
}

export async function findMessageByExternalId(tenantId, provider, externalMessageId) {
  if (!tenantId || !provider || !externalMessageId) return null;
  const { rows } = await pool.query(
    `SELECT id, tenant_id, channel_id, sender_id AS contact, role, content, created_at, status, provider, external_message_id, conversation_id
     FROM messages
     WHERE tenant_id = $1 AND provider = $2 AND external_message_id = $3
     LIMIT 1`,
    [tenantId, String(provider), String(externalMessageId)]
  );
  return rows[0] || null;
}

export async function updateMessageStatusById(messageId, status) {
  const { rows } = await pool.query(
    `UPDATE messages
     SET status = $2, status_updated_at = NOW()
     WHERE id = $1
     RETURNING id, tenant_id, channel_id, sender_id AS contact, role, content, created_at, status, provider, external_message_id, conversation_id, status_updated_at`,
    [messageId, String(status)]
  );
  return rows[0] || null;
}

export async function findMessageByIdForTenant(messageId, tenantId) {
  const { rows } = await pool.query(
    `SELECT id, tenant_id, channel_id, sender_id AS contact, role, content, created_at, status, provider, external_message_id, conversation_id, status_updated_at
     FROM messages
     WHERE id = $1 AND tenant_id = $2
     LIMIT 1`,
    [messageId, tenantId]
  );
  return rows[0] || null;
}

export async function getMessagesMetrics({
  tenantId,
  channelId = null,
  from = null,
  to = null,
}) {
  const params = [tenantId];
  const where = ['m.tenant_id = $1'];

  if (channelId) {
    params.push(channelId);
    where.push(`m.channel_id = $${params.length}`);
  }
  if (from) {
    params.push(from);
    where.push(`m.created_at >= $${params.length}::timestamptz`);
  }
  if (to) {
    params.push(to);
    where.push(`m.created_at <= $${params.length}::timestamptz`);
  }

  const { rows } = await pool.query(
    `SELECT
       COUNT(*)::int AS total_messages,
       SUM(CASE WHEN m.status = 'DELIVERED' THEN 1 ELSE 0 END)::int AS delivered_count,
       SUM(CASE WHEN m.status = 'READ' THEN 1 ELSE 0 END)::int AS read_count,
       SUM(CASE WHEN m.status = 'FAILED' THEN 1 ELSE 0 END)::int AS failed_count
     FROM messages m
     WHERE ${where.join(' AND ')}`,
    params
  );

  const { rows: slaRows } = await pool.query(
    `WITH base AS (
      SELECT m.id, m.created_at
      FROM messages m
      WHERE ${where.join(' AND ')}
    ),
    sent AS (
      SELECT mse.message_id, MIN(mse.created_at) AS sent_at
      FROM message_status_events mse
      JOIN base b ON b.id = mse.message_id
      WHERE mse.event_type = 'SENT'
      GROUP BY mse.message_id
    ),
    delivered AS (
      SELECT mse.message_id, MIN(mse.created_at) AS delivered_at
      FROM message_status_events mse
      JOIN base b ON b.id = mse.message_id
      WHERE mse.event_type = 'DELIVERED'
      GROUP BY mse.message_id
    ),
    read_ev AS (
      SELECT mse.message_id, MIN(mse.created_at) AS read_at
      FROM message_status_events mse
      JOIN base b ON b.id = mse.message_id
      WHERE mse.event_type = 'READ'
      GROUP BY mse.message_id
    )
    SELECT
      AVG(EXTRACT(EPOCH FROM (d.delivered_at - s.sent_at)) * 1000)::bigint AS avg_delivery_time_ms,
      AVG(EXTRACT(EPOCH FROM (r.read_at - d.delivered_at)) * 1000)::bigint AS avg_read_time_ms
    FROM base b
    LEFT JOIN sent s ON s.message_id = b.id
    LEFT JOIN delivered d ON d.message_id = b.id
    LEFT JOIN read_ev r ON r.message_id = b.id`,
    params
  );

  const { rows: durationsRows } = await pool.query(
    `WITH base AS (
      SELECT m.id
      FROM messages m
      WHERE ${where.join(' AND ')}
    ),
    sent AS (
      SELECT mse.message_id, MIN(mse.created_at) AS sent_at
      FROM message_status_events mse
      JOIN base b ON b.id = mse.message_id
      WHERE mse.event_type = 'SENT'
      GROUP BY mse.message_id
    ),
    delivered AS (
      SELECT mse.message_id, MIN(mse.created_at) AS delivered_at
      FROM message_status_events mse
      JOIN base b ON b.id = mse.message_id
      WHERE mse.event_type = 'DELIVERED'
      GROUP BY mse.message_id
    ),
    read_ev AS (
      SELECT mse.message_id, MIN(mse.created_at) AS read_at
      FROM message_status_events mse
      JOIN base b ON b.id = mse.message_id
      WHERE mse.event_type = 'READ'
      GROUP BY mse.message_id
    )
    SELECT
      CASE
        WHEN s.sent_at IS NOT NULL AND d.delivered_at IS NOT NULL
        THEN (EXTRACT(EPOCH FROM (d.delivered_at - s.sent_at)) * 1000)::bigint
        ELSE NULL
      END AS delivery_time_ms,
      CASE
        WHEN d.delivered_at IS NOT NULL AND r.read_at IS NOT NULL
        THEN (EXTRACT(EPOCH FROM (r.read_at - d.delivered_at)) * 1000)::bigint
        ELSE NULL
      END AS read_time_ms
    FROM base b
    LEFT JOIN sent s ON s.message_id = b.id
    LEFT JOIN delivered d ON d.message_id = b.id
    LEFT JOIN read_ev r ON r.message_id = b.id`,
    params
  );

  const deliveryTimesMs = [];
  const readTimesMs = [];
  for (const row of durationsRows) {
    const deliveryValue = row.delivery_time_ms != null ? Number(row.delivery_time_ms) : null;
    const readValue = row.read_time_ms != null ? Number(row.read_time_ms) : null;
    if (deliveryValue != null && Number.isFinite(deliveryValue) && deliveryValue >= 0) {
      deliveryTimesMs.push(deliveryValue);
    }
    if (readValue != null && Number.isFinite(readValue) && readValue >= 0) {
      readTimesMs.push(readValue);
    }
  }

  return {
    totalMessages: rows[0]?.total_messages || 0,
    deliveredCount: rows[0]?.delivered_count || 0,
    readCount: rows[0]?.read_count || 0,
    failedCount: rows[0]?.failed_count || 0,
    avgDeliveryTimeMs: slaRows[0]?.avg_delivery_time_ms ?? null,
    avgReadTimeMs: slaRows[0]?.avg_read_time_ms ?? null,
    deliveryTimesMs,
    readTimesMs,
  };
}

