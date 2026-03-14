/**
 * Repositório: admins – autenticação do painel.
 * Usa connection.js (Neon). Só deve ser chamado quando isConnected() === true.
 */


import { pool } from '../db/pool.js';

/**
import pool from '../db/connection.js';
 * @param {string} email
 * @returns {Promise<{ id: string, email: string, password_hash: string, name: string } | null>}
 */

export async function findByEmail(email) {
  const { rows } = await pool.query(
    'SELECT id, email, password_hash, name, created_at FROM admins WHERE email = $1',
    [email]
  );
  return rows[0] ?? null;
}

/**
 * Busca admin por id (para validar JWT).
 * @param {string} id - UUID do admin
 */

export async function findById(id) {
  const { rows } = await pool.query(
    'SELECT id, tenant_id, email, name, created_at FROM admins WHERE id = $1',
    [id]
  );
  return rows[0] ?? null;
}

/** List admins (users) by tenant_id (SaaS admin). */
export async function findByTenantId(tenantId) {
  const { rows } = await pool.query(
    'SELECT id, tenant_id, email, name, created_at, updated_at FROM admins WHERE tenant_id = $1 ORDER BY name, email',
    [tenantId]
  );
  return rows;
}

/**
 * Cria usuário (admin) do tenant. Global Admin only.
 * @param {string} tenantId
 * @param {{ email: string, password: string, name?: string }} data
 * @param {string} passwordHash - bcrypt hash da senha
 */
export async function create(tenantId, data, passwordHash) {
  const email = String(data.email || '').trim().toLowerCase();
  const name = data.name != null ? String(data.name).trim() : email.split('@')[0] || 'User';
  if (!email) return null;
  const { rows } = await pool.query(
    `INSERT INTO admins (tenant_id, email, password_hash, name)
     VALUES ($1, $2, $3, $4)
     RETURNING id, tenant_id, email, name, created_at, updated_at`,
    [tenantId, email, passwordHash, name]
  );
  return rows[0];
}
