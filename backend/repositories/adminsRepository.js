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
    'SELECT id, tenant_id, email, name, created_at, updated_at, active FROM admins WHERE id = $1',
    [id]
  );
  return rows[0] ?? null;
}

/** List admins (users) by tenant_id (SaaS admin). */
export async function findByTenantId(tenantId) {
  const { rows } = await pool.query(
    'SELECT id, tenant_id, email, name, created_at, updated_at, active FROM admins WHERE tenant_id = $1 ORDER BY name, email',
    [tenantId]
  );
  return rows;
}

/**
 * Lista todos os usuários de tenants com nome do tenant (Global Admin).
 * Inclui coluna active; se a coluna não existir, use migration 006.
 */
export async function findAllWithTenant() {
  const { rows } = await pool.query(`
    SELECT a.id, a.tenant_id, a.email, a.name, a.created_at, a.updated_at, a.active,
           t.name AS tenant_name, t.slug AS tenant_slug
    FROM admins a
    LEFT JOIN tenants t ON t.id = a.tenant_id
    WHERE a.tenant_id IS NOT NULL
    ORDER BY a.created_at DESC
  `);
  return rows;
}

/**
 * Atualiza email e/ou name do usuário.
 */
export async function updateUser(id, data) {
  const updates = [];
  const values = [];
  let pos = 1;
  if (data.email !== undefined) {
    updates.push(`email = $${pos++}`);
    values.push(String(data.email).trim().toLowerCase());
  }
  if (data.name !== undefined) {
    updates.push(`name = $${pos++}`);
    values.push(data.name != null ? String(data.name).trim() : null);
  }
  if (updates.length === 0) return findById(id);
  values.push(id);
  const { rows } = await pool.query(
    `UPDATE admins SET ${updates.join(', ')}, updated_at = now() WHERE id = $${pos} RETURNING id, tenant_id, email, name, created_at, updated_at, active`,
    values
  );
  return rows[0] ?? null;
}

/**
 * Ativa ou desativa o usuário (active = true/false).
 */
export async function toggleActive(id, active) {
  const { rows } = await pool.query(
    'UPDATE admins SET active = $2, updated_at = now() WHERE id = $1 RETURNING id, tenant_id, email, name, active, created_at, updated_at',
    [id, !!active]
  );
  return rows[0] ?? null;
}

/**
 * Remove usuário por id.
 */
export async function deleteUser(id) {
  const { rowCount } = await pool.query('DELETE FROM admins WHERE id = $1', [id]);
  return rowCount > 0;
}

/**
 * Conta usuários ativos (active = true) do tenant.
 */
export async function countActiveUsersByTenant(tenantId) {
  const { rows } = await pool.query(
    'SELECT COUNT(*)::int AS count FROM admins WHERE tenant_id = $1 AND active = true',
    [tenantId]
  );
  return rows[0]?.count ?? 0;
}

/**
 * Atualiza apenas a senha (hash) do usuário.
 */
export async function updatePassword(id, passwordHash) {
  const { rows } = await pool.query(
    'UPDATE admins SET password_hash = $2, updated_at = now() WHERE id = $1 RETURNING id, tenant_id, email',
    [id, passwordHash]
  );
  return rows[0] ?? null;
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
