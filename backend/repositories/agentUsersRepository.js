/**
 * Repositório: agent_users – autenticação exclusiva AGENTE IA OMNICANAL (isolado do SIS-ACOLHE).
 */

import { query } from '../db/connection.js';
import pool from '../db/connection.js';

export async function findByEmail(email) {
  const { rows } = await query(
    'SELECT id, name, email, password, role, created_at FROM agent_users WHERE email = $1',
    [email]
  );
  return rows[0] ?? null;
}

export async function findById(id) {
  const { rows } = await query(
    'SELECT id, name, email, role FROM agent_users WHERE id = $1',
    [id]
  );
  return rows[0] ?? null;
}
