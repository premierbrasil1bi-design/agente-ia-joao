/**
 * Repositório: agents – acesso ao banco (Neon).
 * Multi-agente por cliente.
 */

import { query } from '../db/connection.js';

export async function findAll(clientId = null) {
  if (clientId) {
    const { rows } = await query(
      'SELECT id, client_id, name, slug, status, created_at, updated_at FROM agents WHERE client_id = $1 ORDER BY name',
      [clientId]
    );
    return rows;
  }
  const { rows } = await query(
    'SELECT id, client_id, name, slug, status, created_at, updated_at FROM agents ORDER BY name'
  );
  return rows;
}

export async function findById(id) {
  const { rows } = await query(
    'SELECT id, client_id, name, slug, status, created_at, updated_at FROM agents WHERE id = $1',
    [id]
  );
  return rows[0] ?? null;
}

/**
 * Verifica se já existe agente com client_id + slug.
 */
export async function existsByClientAndSlug(clientId, slug) {
  const { rows } = await query(
    'SELECT 1 FROM agents WHERE client_id = $1 AND slug = $2 LIMIT 1',
    [clientId, slug]
  );
  return rows.length > 0;
}

export async function create({ clientId, name, slug, status = 'ativo' }) {
  const { rows } = await query(
    'INSERT INTO agents (client_id, name, slug, status) VALUES ($1, $2, $3, $4) RETURNING id, client_id, name, slug, status, created_at, updated_at',
    [clientId, name, slug, status]
  );
  return rows[0];
}

export async function update(id, { name, slug, status }) {
  const { rows } = await query(
    `UPDATE agents SET
      name = COALESCE($2, name),
      slug = COALESCE($3, slug),
      status = COALESCE($4, status)
    WHERE id = $1 RETURNING id, client_id, name, slug, status, created_at, updated_at`,
    [id, name ?? null, slug ?? null, status ?? null]
  );
  return rows[0] ?? null;
}

export async function remove(id) {
  const { rowCount } = await query('DELETE FROM agents WHERE id = $1', [id]);
  return rowCount > 0;
}

/**
 * Atualiza apenas o status (soft delete: status = 'inativo').
 * @param {string} id - UUID do agente
 * @param {string} status - 'ativo' | 'inativo' | 'erro'
 * @returns {Promise<{ id, client_id, name, slug, status, created_at, updated_at } | null>}
 */
export async function setStatus(id, status) {
  const valid = ['ativo', 'inativo', 'erro'].includes(status);
  if (!valid) return null;
  const { rows } = await query(
    'UPDATE agents SET status = $2 WHERE id = $1 RETURNING id, client_id, name, slug, status, created_at, updated_at',
    [id, status]
  );
  return rows[0] ?? null;
}
