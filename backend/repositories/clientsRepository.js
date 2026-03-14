/**
 * Repositório: clients – acesso ao banco (Neon).
 * Preparação multi-tenant / comercialização.
 */


import { pool } from '../db/pool.js';


export async function findAll() {
  const { rows } = await pool.query(
    'SELECT id, tenant_id, name, slug, created_at, updated_at FROM clients ORDER BY name'
  );
  return rows;
}

export async function findByTenantId(tenantId) {
  const { rows } = await pool.query(
    'SELECT id, tenant_id, name, slug, created_at, updated_at FROM clients WHERE tenant_id = $1 ORDER BY name',
    [tenantId]
  );
  return rows;
}

export async function findFirstByTenantId(tenantId) {
  const { rows } = await pool.query(
    'SELECT id, tenant_id, name, slug, created_at, updated_at FROM clients WHERE tenant_id = $1 ORDER BY created_at LIMIT 1',
    [tenantId]
  );
  return rows[0] ?? null;
}


export async function findById(id) {
  const { rows } = await pool.query(
    'SELECT id, tenant_id, name, slug, created_at, updated_at FROM clients WHERE id = $1',
    [id]
  );
  return rows[0] ?? null;
}


export async function create({ name, slug, tenantId }) {
  const { rows } = await pool.query(
    'INSERT INTO clients (tenant_id, name, slug) VALUES ($1, $2, $3) RETURNING id, tenant_id, name, slug, created_at, updated_at',
    [tenantId, name, slug]
  );
  return rows[0];
}

/** Create with tenant_id (for SaaS admin). */
export async function createForTenant(tenantId, { name, slug }) {
  return create({ name, slug, tenantId });
}


export async function update(id, { name, slug }) {
  const { rows } = await pool.query(
    'UPDATE clients SET name = COALESCE($2, name), slug = COALESCE($3, slug) WHERE id = $1 RETURNING id, name, slug, created_at, updated_at',
    [id, name ?? null, slug ?? null]
  );
  return rows[0] ?? null;
}

export async function remove(id) {
  // const { rowCount } = await query('DELETE FROM clients WHERE id = $1', [id]); // Removido: duplicado
  const deleteResult = await pool.query('DELETE FROM clients WHERE id = $1', [id]);
  return deleteResult.rowCount > 0;
}
