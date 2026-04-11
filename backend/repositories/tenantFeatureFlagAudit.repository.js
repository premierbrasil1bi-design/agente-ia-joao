import { pool } from '../db/pool.js';

/**
 * @param {{
 *   tenantId: string,
 *   changedBy: string,
 *   previousFlags: Record<string, unknown>,
 *   newFlags: Record<string, unknown>,
 *   effectivePreviousFlags: Record<string, unknown>,
 *   effectiveNewFlags: Record<string, unknown>,
 * }} row
 * @param {import('pg').PoolClient} [client] — conexão de transação; se omitido, usa o pool.
 */
export async function insertTenantFeatureFlagAudit(row, client = null) {
  const executor = client || pool;
  const r = await executor.query(
    `
    INSERT INTO tenant_feature_flag_audit (
      tenant_id,
      changed_by,
      previous_flags,
      new_flags,
      effective_previous_flags,
      effective_new_flags
    )
    VALUES ($1::uuid, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb)
    RETURNING id, tenant_id, changed_by, previous_flags, new_flags,
      effective_previous_flags, effective_new_flags, created_at;
    `,
    [
      row.tenantId,
      String(row.changedBy || '').trim() || 'unknown',
      JSON.stringify(row.previousFlags ?? {}),
      JSON.stringify(row.newFlags ?? {}),
      JSON.stringify(row.effectivePreviousFlags ?? {}),
      JSON.stringify(row.effectiveNewFlags ?? {}),
    ],
  );
  return r.rows[0] ?? null;
}

/**
 * @param {string} tenantId
 * @param {number} [limit=20]
 */
export async function getTenantFeatureFlagAudit(tenantId, limit = 20) {
  const lim = Math.min(100, Math.max(1, Number(limit) || 20));
  const r = await pool.query(
    `
    SELECT
      id,
      tenant_id,
      changed_by,
      previous_flags,
      new_flags,
      effective_previous_flags,
      effective_new_flags,
      created_at
    FROM tenant_feature_flag_audit
    WHERE tenant_id = $1::uuid
    ORDER BY created_at DESC
    LIMIT $2::int;
    `,
    [tenantId, lim],
  );
  return r.rows;
}

/**
 * @param {string} tenantId
 * @param {string} auditId
 * @param {import('pg').PoolClient} [client] — conexão de transação; se omitido, usa o pool.
 */
export async function getTenantFeatureFlagAuditById(tenantId, auditId, client = null) {
  const executor = client || pool;
  const r = await executor.query(
    `
    SELECT
      id,
      tenant_id,
      changed_by,
      previous_flags,
      new_flags,
      effective_previous_flags,
      effective_new_flags,
      created_at
    FROM tenant_feature_flag_audit
    WHERE tenant_id = $1::uuid AND id = $2::uuid
    LIMIT 1;
    `,
    [tenantId, auditId],
  );
  return r.rows[0] ?? null;
}
