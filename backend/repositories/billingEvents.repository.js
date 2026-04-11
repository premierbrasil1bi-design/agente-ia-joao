import { pool } from '../db/pool.js';

/**
 * @param {import('pg').PoolClient} client
 * @param {string} provider
 * @param {string} providerEventId
 */
export async function selectBillingEventForUpdate(client, provider, providerEventId) {
  const r = await client.query(
    `
    SELECT id, status, provider_event_id, provider, tenant_id, type, payload, error_message, processed_at
    FROM billing_events
    WHERE provider = $1 AND provider_event_id = $2
    FOR UPDATE
    `,
    [provider, providerEventId],
  );
  return r.rows[0] ?? null;
}

/**
 * @param {import('pg').PoolClient} client
 * @param {{ provider_event_id: string, provider: string, tenant_id: string|null, type: string, payload: object }} row
 */
export async function insertBillingEventPending(client, row) {
  const r = await client.query(
    `
    INSERT INTO billing_events (provider_event_id, provider, tenant_id, type, status, payload)
    VALUES ($1, $2, $3::uuid, $4, 'pending', $5::jsonb)
    RETURNING id, status
    `,
    [
      row.provider_event_id,
      row.provider,
      row.tenant_id,
      row.type,
      JSON.stringify(row.payload ?? {}),
    ],
  );
  return r.rows[0];
}

/**
 * @param {import('pg').PoolClient} client
 * @param {string} id
 * @param {{ status: 'processed'|'ignored'|'failed', error_message?: string|null }} patch
 */
export async function updateBillingEventOutcome(client, id, patch) {
  await client.query(
    `
    UPDATE billing_events
    SET
      status = $2,
      processed_at = CASE WHEN $2 IN ('processed', 'ignored') THEN NOW() ELSE NULL END,
      error_message = CASE
        WHEN $2 IN ('processed', 'ignored') THEN NULL
        ELSE COALESCE($3, error_message)
      END
    WHERE id = $1::uuid
    `,
    [id, patch.status, patch.error_message ?? null],
  );
}

/**
 * @param {string} id — UUID interno billing_events.id
 */
export async function getBillingEventById(id) {
  const r = await pool.query(`SELECT * FROM billing_events WHERE id = $1::uuid`, [id]);
  return r.rows[0] ?? null;
}

/**
 * @param {import('pg').PoolClient} client
 * @param {string} id
 */
export async function resetBillingEventToPending(client, id) {
  await client.query(
    `
    UPDATE billing_events
    SET status = 'pending', error_message = NULL, processed_at = NULL
    WHERE id = $1::uuid AND status = 'failed'
    `,
    [id],
  );
}

/**
 * @param {import('pg').PoolClient} client
 * @param {string} id
 */
export async function selectBillingEventByIdForUpdate(client, id) {
  const r = await client.query(
    `SELECT * FROM billing_events WHERE id = $1::uuid FOR UPDATE`,
    [id],
  );
  return r.rows[0] ?? null;
}
