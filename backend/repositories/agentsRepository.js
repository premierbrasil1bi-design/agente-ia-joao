/**
 * Repositório: agents – acesso ao banco (Neon).
 * Multi-agente por cliente / por tenant (SaaS admin).
 */


import { pool } from '../db/pool.js';
import { findFirstByTenantId, createForTenant as createClientForTenant } from './clientsRepository.js';


export async function findAll(clientId) {
  if (clientId) {
    const { rows } = await pool.query(
      'SELECT id, tenant_id, client_id, name, slug, description, status, created_at, updated_at FROM agents WHERE client_id = $1 ORDER BY name',
      [clientId]
    );
    return rows;
  }
  const { rows } = await pool.query(
    'SELECT id, tenant_id, client_id, name, slug, description, status, created_at, updated_at FROM agents ORDER BY name'
  );
  return rows;
}

/** List agents by tenant_id (SaaS admin). */
export async function findByTenantId(tenantId) {
  const { rows } = await pool.query(
    `SELECT id, tenant_id, client_id, name, slug, description, status, created_at, updated_at
     FROM agents WHERE tenant_id = $1 ORDER BY name`,
    [tenantId]
  );
  return rows;
}


export async function findById(id) {
  const { rows } = await pool.query(
    'SELECT id, tenant_id, client_id, name, slug, description, status, created_at, updated_at FROM agents WHERE id = $1',
    [id]
  );
  return rows[0] ?? null;
}

/** Find by id and tenant_id (ensure tenant scope). */
export async function findByIdAndTenantId(id, tenantId) {
  const { rows } = await pool.query(
    'SELECT id, tenant_id, client_id, name, slug, description, status, created_at, updated_at FROM agents WHERE id = $1 AND tenant_id = $2',
    [id, tenantId]
  );
  return rows[0] ?? null;
}

/**
 * Verifica se já existe agente com client_id + slug.
 */

export async function existsByClientIdAndSlug(clientId, slug) {
  const { rows } = await pool.query(
    'SELECT 1 FROM agents WHERE client_id = $1 AND slug = $2 LIMIT 1',
    [clientId, slug]
  );
  return rows.length > 0;
}


export async function create({ clientId, tenantId, name, slug, description, status }) {
  const { rows } = await pool.query(
    `INSERT INTO agents (tenant_id, client_id, name, slug, description, status)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, tenant_id, client_id, name, slug, description, status, created_at, updated_at`,
    [tenantId ?? null, clientId, name, slug, description ?? null, status ?? 'ativo']
  );
  return rows[0];
}

/** Create agent for a tenant (gets or creates default client). */
export async function createForTenant(tenantId, { name, slug, description, status }) {
  let client = await findFirstByTenantId(tenantId);
  if (!client) {
    client = await createClientForTenant(tenantId, { name: 'Default', slug: `default-${tenantId}` });
  }
  return create({
    clientId: client.id,
    tenantId,
    name: name || 'Agente',
    slug: slug || `agente-${Date.now()}`,
    description,
    status: status || 'ativo',
  });
}


export async function update(id, { name, slug, description, status }) {
  const { rows } = await pool.query(
    `UPDATE agents SET
      name = COALESCE($2, name),
      slug = COALESCE($3, slug),
      description = COALESCE($4, description),
      status = COALESCE($5, status)
    WHERE id = $1 RETURNING id, tenant_id, client_id, name, slug, description, status, created_at, updated_at`,
    [id, name ?? null, slug ?? null, description ?? null, status ?? null]
  );
  return rows[0] ?? null;
}


export async function remove(id) {
  const { rowCount } = await pool.query('DELETE FROM agents WHERE id = $1', [id]);
  return rowCount > 0;
}

/**
 * Atualiza apenas o status (soft delete: status = 'inativo').
 * @param {string} id - UUID do agente
 * @param {string} status - 'ativo' | 'inativo' | 'erro'
 * @returns {Promise<{ id, client_id, name, slug, status, created_at, updated_at } | null>}
 */

export async function updateStatus(id, status) {
  const valid = ['ativo', 'inativo', 'erro'].includes(status);
  if (!valid) return null;
  const { rows } = await pool.query(
    'UPDATE agents SET status = $2 WHERE id = $1 RETURNING id, client_id, name, slug, status, created_at, updated_at',
    [id, status]
  );
  return rows[0] ?? null;
}
