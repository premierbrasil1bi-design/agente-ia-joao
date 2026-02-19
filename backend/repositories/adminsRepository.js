/**
 * Repositório: admins – autenticação do painel.
 * Usa connection.js (Neon). Só deve ser chamado quando isConnected() === true.
 */

import { query } from '../db/connection.js';

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
    'SELECT id, email, name FROM admins WHERE id = $1',
    [id]
  );
  return rows[0] ?? null;
}
