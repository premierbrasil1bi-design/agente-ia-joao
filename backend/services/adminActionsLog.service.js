import { pool } from '../db/pool.js';

let ensured = false;

async function ensureAdminActionsTable() {
  if (ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_actions_log (
      id BIGSERIAL PRIMARY KEY,
      action TEXT NOT NULL,
      entity TEXT NOT NULL,
      entity_id TEXT NULL,
      metadata JSONB NULL,
      performed_by TEXT NULL,
      role TEXT NULL,
      status TEXT NOT NULL,
      message TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  ensured = true;
}

export async function logAdminAction(entry) {
  try {
    await ensureAdminActionsTable();
    await pool.query(
      `INSERT INTO admin_actions_log
       (action, entity, entity_id, metadata, performed_by, role, status, message)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)`,
      [
        entry.action,
        entry.entity,
        entry.entityId ?? null,
        JSON.stringify(entry.metadata ?? {}),
        entry.performedBy ?? null,
        entry.role ?? null,
        entry.status,
        entry.message ?? null,
      ]
    );
  } catch {
    // auditoria não deve bloquear operação principal
  }
}

