import { pool } from '../db/pool.js';

export async function createStatusEvent({ messageId, tenantId, provider, eventType, rawPayload = {} }) {
  const { rows } = await pool.query(
    `INSERT INTO message_status_events (message_id, tenant_id, provider, event_type, raw_payload)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     RETURNING id, message_id, tenant_id, provider, event_type, raw_payload, created_at`,
    [messageId, tenantId, String(provider || 'unknown'), String(eventType || 'PENDING'), JSON.stringify(rawPayload || {})]
  );
  return rows[0];
}

export async function listStatusEventsByMessage({ messageId, tenantId }) {
  const { rows } = await pool.query(
    `SELECT id, message_id, tenant_id, provider, event_type, raw_payload, created_at
     FROM message_status_events
     WHERE message_id = $1 AND tenant_id = $2
     ORDER BY created_at ASC`,
    [messageId, tenantId]
  );
  return rows;
}

