/**
 * Repositório: clients – acesso ao banco (Neon).
 * Preparação multi-tenant / comercialização.
 */

import { query } from '../db/connection.js';

export async function findAll() {
  const { rows } = await query(
    'SELECT id, name, slug, created_at, updated_at FROM clients ORDER BY name'
  );
  return rows;
}

export async function findById(id) {
  const { rows } = await query(
    'SELECT id, name, slug, created_at, updated_at FROM clients WHERE id = $1',
    [id]
  );
  return rows[0] ?? null;
}

export async function create({ name, slug }) {
  const { rows } = await query(
    'INSERT INTO clients (name, slug) VALUES ($1, $2) RETURNING id, name, slug, created_at, updated_at',
    [name, slug]
  );
  return rows[0];
}

export async function update(id, { name, slug }) {
  const { rows } = await query(
    'UPDATE clients SET name = COALESCE($2, name), slug = COALESCE($3, slug) WHERE id = $1 RETURNING id, name, slug, created_at, updated_at',
    [id, name ?? null, slug ?? null]
  );
  return rows[0] ?? null;
}

export async function remove(id) {
  const { rowCount } = await query('DELETE FROM clients WHERE id = $1', [id]);
  return rowCount > 0;
}
