
import { pool } from '../db/pool.js';
import { toTenantApiRow } from '../utils/tenantMapper.js';

export async function createTenant(data) {
  const {
    nome_empresa,
    name,
    slug,
    plan,
    max_agents,
    max_messages,
    status,
    active,
  } = data;

  const nomeEmpresaFinal = nome_empresa ?? name;
  const statusFinal =
    status ??
    (typeof active === 'boolean'
      ? active
        ? 'Ativo'
        : 'Inativo'
      : 'Ativo');

  const result = await pool.query(
    `
    INSERT INTO tenants (nome_empresa, slug, plan, max_agents, max_messages, status)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
    `,
    [nomeEmpresaFinal, slug, plan, max_agents, max_messages, statusFinal]
  );
  return toTenantApiRow(result.rows[0]);
}

export async function getAllTenants() {
  const result = await pool.query(
    'SELECT * FROM tenants ORDER BY created_at DESC'
  );
  return result.rows.map((row) => toTenantApiRow(row));
}

export async function getTenantById(id) {
  const result = await pool.query(
    'SELECT * FROM tenants WHERE id = $1',
    [id]
  );
  return toTenantApiRow(result.rows[0]);
}

export async function updateTenant(id, data) {
  const {
    nome_empresa,
    name,
    plan,
    max_agents,
    max_messages,
    status,
    active,
  } = data;

  const nomeEmpresaFinal = nome_empresa ?? name;
  const statusFinal =
    status ??
    (typeof active === 'boolean'
      ? active
        ? 'Ativo'
        : 'Inativo'
      : undefined);

  const result = await pool.query(
    `
    UPDATE tenants
    SET nome_empresa = COALESCE($1, nome_empresa),
        plan = COALESCE($2, plan),
        max_agents = COALESCE($3, max_agents),
        max_messages = COALESCE($4, max_messages),
        status = COALESCE($5, status),
        updated_at = now()
    WHERE id = $6
    RETURNING *
    `,
    [nomeEmpresaFinal ?? null, plan ?? null, max_agents ?? null, max_messages ?? null, statusFinal ?? null, id]
  );
  return toTenantApiRow(result.rows[0]);
}

export async function deleteTenant(id) {
  await pool.query(
    'DELETE FROM tenants WHERE id = $1',
    [id]
  );
}


