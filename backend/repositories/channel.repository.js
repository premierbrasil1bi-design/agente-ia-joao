/**
 * Repository: channels – CRUD com escopo por tenant_id.
 * Usado pelas rotas /api/channels (Client App).
 */

import { pool } from '../db/pool.js';
import { emitChannelUpdated } from '../utils/channelRealtime.js';

const CHANNEL_SELECT = `id, tenant_id, agent_id, name, type, instance, is_active AS active,
  provider, fallback_providers, config, provider_config, external_id, connected_at, last_error, status, connection_status,
  created_at, updated_at`;

function withProviderConfigFallback(row) {
  if (!row || typeof row !== 'object') return row;
  const providerConfig = row.provider_config && typeof row.provider_config === 'object' ? row.provider_config : {};
  return { ...row, provider_config: providerConfig };
}

export async function findAllByTenant(tenantId) {
  const { rows } = await pool.query(
    `SELECT ${CHANNEL_SELECT} FROM channels WHERE tenant_id = $1 ORDER BY created_at DESC`,
    [tenantId]
  );
  return rows.map(withProviderConfigFallback);
}

export async function findById(id, tenantId) {
  const { rows } = await pool.query(
    `SELECT ${CHANNEL_SELECT} FROM channels WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId]
  );
  const row = rows[0] ?? null;
  return row ? withProviderConfigFallback(row) : null;
}

/**
 * Canais elegíveis para monitor de saúde contínuo.
 * Não altera schema; leitura leve para auto-healing.
 */
export async function findActiveChannels() {
  const { rows } = await pool.query(
    `SELECT id, type, provider, instance, tenant_id
     FROM channels
     WHERE status = 'connected'
        OR status = 'active'
        OR status IS NULL`
  );
  return rows;
}

/** Evita duplicate key em idx_channels_type_instance (mesmo tenant, mesmo type+instance). */
export async function findByTenantTypeAndInstance(tenantId, type, instance) {
  if (!tenantId || !type || instance == null || String(instance).trim() === '') return null;
  const { rows } = await pool.query(
    `SELECT ${CHANNEL_SELECT} FROM channels WHERE tenant_id = $1 AND type = $2 AND instance = $3 LIMIT 1`,
    [tenantId, String(type).toLowerCase().trim(), String(instance).trim()]
  );
  const row = rows[0] ?? null;
  return row ? withProviderConfigFallback(row) : null;
}

/**
 * @param {Object} data - { tenant_id, agent_id, type, instance?, name?, active? }
 */
export async function create(data) {
  const tenantId = data.tenant_id;
  const agentId = data.agent_id;
  const type = String(data.type || 'api').toLowerCase().trim();
  const instance = data.instance != null ? String(data.instance).trim() : null;
  const active = data.active !== undefined ? Boolean(data.active) : true;
  const name =
    data.name != null && String(data.name).trim() !== ''
      ? String(data.name).trim().slice(0, 100)
      : (instance || type).slice(0, 100);

  const { rows } = await pool.query(
    `INSERT INTO channels (tenant_id, agent_id, name, type, instance, is_active)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, tenant_id, agent_id, type, instance, is_active AS active, created_at, updated_at`,
    [tenantId, agentId, name, type, instance, active]
  );
  return rows[0];
}

/**
 * @param {string} id
 * @param {string} tenantId
 * @param {Object} data - { type?, instance?, agent_id?, active? }
 */
export async function update(id, tenantId, data) {
  const updates = [];
  const values = [];
  let pos = 1;

  if (data.type !== undefined) {
    updates.push(`type = $${pos}`);
    values.push(String(data.type).toLowerCase().trim());
    pos += 1;
  }
  if (data.instance !== undefined) {
    updates.push(`instance = $${pos}`);
    values.push(data.instance != null ? String(data.instance).trim() : null);
    pos += 1;
  }
  if (data.agent_id !== undefined) {
    updates.push(`agent_id = $${pos}`);
    values.push(data.agent_id);
    pos += 1;
  }
  if (data.active !== undefined) {
    updates.push(`is_active = $${pos}`);
    values.push(Boolean(data.active));
    pos += 1;
  }

  if (updates.length === 0) {
    return findById(id, tenantId);
  }

  values.push(id, tenantId);
  const { rows } = await pool.query(
    `UPDATE channels
     SET ${updates.join(', ')}, updated_at = now()
     WHERE id = $${pos} AND tenant_id = $${pos + 1}
     RETURNING id, tenant_id, agent_id, type, instance, is_active AS active, created_at, updated_at`,
    values
  );
  return rows[0] ?? null;
}

/**
 * Atualiza apenas campos de conexão (Evolution etc.).
 * @param {Object} data - { provider?, external_id?, status?, connection_status?, connected_at?, last_error?, config?, provider_config? }
 */
export async function updateConnection(id, tenantId, data) {
  const updates = [];
  const values = [];
  let pos = 1;
  if (data.provider !== undefined) {
    updates.push(`provider = $${pos}`);
    values.push(data.provider != null ? String(data.provider) : null);
    pos += 1;
  }
  if (data.fallback_providers !== undefined) {
    updates.push(`fallback_providers = $${pos}::jsonb`);
    values.push(JSON.stringify(Array.isArray(data.fallback_providers) ? data.fallback_providers : []));
    pos += 1;
  }
  if (data.external_id !== undefined) {
    updates.push(`external_id = $${pos}`);
    values.push(data.external_id != null ? String(data.external_id) : null);
    pos += 1;
  }
  if (data.status !== undefined) {
    updates.push(`status = $${pos}`);
    values.push(data.status != null ? String(data.status) : null);
    pos += 1;
  }
  if (data.connection_status !== undefined) {
    updates.push(`connection_status = $${pos}`);
    values.push(data.connection_status != null ? String(data.connection_status) : null);
    pos += 1;
  }
  if (data.connected_at !== undefined) {
    updates.push(`connected_at = $${pos}`);
    values.push(data.connected_at);
    pos += 1;
  }
  if (data.last_error !== undefined) {
    updates.push(`last_error = $${pos}`);
    values.push(data.last_error != null ? String(data.last_error) : null);
    pos += 1;
  }
  if (data.config !== undefined) {
    updates.push(`config = $${pos}::jsonb`);
    values.push(JSON.stringify(data.config || {}));
    pos += 1;
  }
  if (data.provider_config !== undefined) {
    updates.push(`provider_config = $${pos}::jsonb`);
    values.push(JSON.stringify(data.provider_config || {}));
    pos += 1;
  }
  if (updates.length === 0) return findById(id, tenantId);
  values.push(id, tenantId);
  const { rows } = await pool.query(
    `UPDATE channels SET ${updates.join(', ')}, updated_at = now()
     WHERE id = $${pos} AND tenant_id = $${pos + 1}
     RETURNING ${CHANNEL_SELECT}`,
    values
  );
  const updated = rows[0] ?? null;
  const out = updated ? withProviderConfigFallback(updated) : null;
  if (out) emitChannelUpdated(out, { source: 'repository.updateConnection' });
  return out;
}

export async function deleteById(id, tenantId) {
  const { rowCount } = await pool.query(
    'DELETE FROM channels WHERE id = $1 AND tenant_id = $2',
    [id, tenantId]
  );
  return rowCount > 0;
}
