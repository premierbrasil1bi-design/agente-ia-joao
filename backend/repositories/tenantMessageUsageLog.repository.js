import { pool } from '../db/pool.js';

const VALID_EVENTS = new Set(['consume', 'refund', 'success']);

/**
 * Extrai identificador externo da resposta do provider (quando existir).
 * @param {unknown} out
 * @returns {string | null}
 */
export function extractProviderMessageIdForAudit(out) {
  if (out == null || typeof out !== 'object') return null;
  const o = out;
  const candidates = [o.id, o.messageId, o.key?.id, o.data?.id];
  for (const c of candidates) {
    if (c != null && String(c).trim() !== '') return String(c);
  }
  return null;
}

/**
 * Insert simples para auditoria. Preferir não await no caminho crítico (fire-and-forget + .catch).
 * @param {{ tenantId: string, eventType: 'consume'|'refund'|'success', provider?: string | null, messageId?: string | null }} row
 * @returns {Promise<void>}
 */
export async function insertTenantMessageUsageLog(row) {
  const tenantId = row?.tenantId;
  const eventType = row?.eventType;
  if (!tenantId || !VALID_EVENTS.has(eventType)) return;

  await pool.query(
    `
    INSERT INTO tenant_message_usage_logs (tenant_id, event_type, provider, message_id)
    VALUES ($1::uuid, $2::text, $3::text, $4::text);
    `,
    [tenantId, eventType, row.provider ?? null, row.messageId ?? null]
  );
}

/**
 * Enfileira log sem bloquear o fluxo principal.
 * @param {{ tenantId: string, eventType: 'consume'|'refund'|'success', provider?: string | null, messageId?: string | null }} row
 */
export function logTenantMessageUsageAsync(row) {
  insertTenantMessageUsageLog(row).catch((err) => {
    console.error('[tenant_message_usage_logs] insert failed', err?.message || err);
  });
}

/**
 * Uso do período atual por eventos `success` em tenant_message_usage_logs,
 * desde COALESCE(billing_cycle_start, created_at) do tenant (sem usar messages_used_current_period).
 * @param {string} tenantId
 * @returns {Promise<{ id: string, plan: string | null, max_messages: number | null, billing_cycle_start: Date, messages_used_success: number } | null>}
 */
export async function getTenantMessageUsageFromLogs(tenantId) {
  const { rows } = await pool.query(
    `
    WITH t AS (
      SELECT
        id,
        plan,
        max_messages,
        COALESCE(billing_cycle_start, created_at) AS cycle_start
      FROM tenants
      WHERE id = $1::uuid
    )
    SELECT
      t.id,
      t.plan,
      t.max_messages,
      t.cycle_start AS billing_cycle_start,
      COALESCE(
        (
          SELECT COUNT(*)::int
          FROM tenant_message_usage_logs l
          WHERE l.tenant_id = t.id
            AND l.event_type = 'success'
            AND l.created_at >= t.cycle_start
        ),
        0
      ) AS messages_used_success
    FROM t;
    `,
    [tenantId]
  );
  return rows[0] ?? null;
}
