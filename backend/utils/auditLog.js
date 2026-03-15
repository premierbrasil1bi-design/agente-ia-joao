/**
 * Registro de auditoria para ações do Global Admin.
 * Se a tabela global_admin_logs não existir ou o insert falhar, não quebra a operação principal.
 */

import { pool } from '../db/pool.js';

const ACTIONS = {
  tenant_user_created: 'tenant_user_created',
  tenant_user_updated: 'tenant_user_updated',
  tenant_user_toggled: 'tenant_user_toggled',
  tenant_user_deleted: 'tenant_user_deleted',
  tenant_user_password_reset: 'tenant_user_password_reset',
};

/**
 * @param {string} action - Um dos ACTIONS
 * @param {string} targetId - id do recurso (ex: id do usuário)
 */
export async function logGlobalAdminAction(action, targetId) {
  try {
    await pool.query(
      `INSERT INTO global_admin_logs (action, target_id, created_at)
       VALUES ($1, $2, now())`,
      [action, targetId ?? null]
    );
  } catch (err) {
    console.warn('[audit] global_admin_logs insert failed:', err.message);
  }
}

export { ACTIONS };
