/**
 * Repositório: channels – acesso ao banco (Neon).
 * Canais por agente (WhatsApp, Instagram, Web, API).
 */


import { pool } from '../db/pool.js';
import { fireEvolutionInvariantBrokenAlert } from '../services/evolutionInvariantAlert.service.js';


export async function findByAgentId(agentId) {
  const { rows } = await pool.query(
    `SELECT id, tenant_id, agent_id, name, type, status, is_active, message_count, created_at, updated_at
     FROM channels WHERE agent_id = $1 ORDER BY name`,
    [agentId]
  );
  return rows;
}

/** List channels by tenant_id (SaaS admin). */
export async function findByTenantId(tenantId) {
  const { rows } = await pool.query(
    `SELECT id, tenant_id, agent_id, name, type, status, is_active, message_count, created_at, updated_at
     FROM channels WHERE tenant_id = $1 ORDER BY name`,
    [tenantId]
  );
  return rows;
}

/** Find by id and tenant_id (ensure tenant scope). */
export async function findByIdAndTenantId(id, tenantId) {
  const { rows } = await pool.query(
    `SELECT id, tenant_id, agent_id, name, type, status, is_active, message_count, created_at, updated_at
     FROM channels WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId]
  );
  return rows[0] ?? null;
}

/**
 * Find channel by type and instance (for agent router – instance → agent resolution).
 * Requires channels.instance column (migration 001_add_channels_instance.sql).
 */
export async function findByTypeAndInstance(type, instance) {
  if (!type || instance == null || instance === '') {
    return null;
  }
  const { rows } = await pool.query(
    `SELECT id, agent_id, name, type, status, is_active, instance
     FROM channels WHERE type = $1 AND instance = $2 AND is_active = true LIMIT 1`,
    [String(type).toLowerCase().trim(), String(instance).trim()]
  );
  return rows[0] ?? null;
}


export async function findById(id) {
  const { rows } = await pool.query(
    'SELECT id, tenant_id, agent_id, name, type, status, is_active, message_count, created_at, updated_at FROM channels WHERE id = $1',
    [id]
  );
  return rows[0] ?? null;
}

/**
 * Find channel by external_id (ex: Evolution instance name).
 * Usado pelo webhook Evolution para resolver agent_id a partir do instance.
 */
export async function findByExternalId(externalId) {
  if (!externalId || String(externalId).trim() === '') return null;
  const { rows } = await pool.query(
    `SELECT id, tenant_id, agent_id, name, type, status, is_active, instance, external_id, connection_status
     FROM channels WHERE external_id = $1 LIMIT 1`,
    [String(externalId).trim()]
  );
  return rows[0] ?? null;
}

/**
 * Canal Evolution para o external_id (instance name na API). Pós-migration 011, no máximo uma linha.
 * Query defensiva LIMIT 2: se ainda houver mais de um (índice ausente ou dados legados), loga e retorna null.
 */
export async function findEvolutionChannelByExternalId(externalId) {
  if (!externalId || String(externalId).trim() === '') return null;
  const ext = String(externalId).trim();
  const { rows } = await pool.query(
    `SELECT id, tenant_id, agent_id, name, type, status, is_active, instance, external_id, connection_status,
            provider
     FROM channels
     WHERE external_id = $1 AND provider IN ('evolution', 'waha')
     LIMIT 2`,
    [ext]
  );
  if (rows.length > 1) {
    let totalDup = rows.length;
    try {
      const { rows: cnt } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM channels WHERE external_id = $1 AND provider IN ('evolution', 'waha')`,
        [ext]
      );
      totalDup = cnt[0]?.n ?? rows.length;
    } catch {
      /* ignora — log principal já cobre */
    }
    const channels = rows.map((r) => ({
      id: r.id,
      tenant_id: r.tenant_id,
      provider: r.provider != null ? String(r.provider) : 'evolution',
    }));
    // PM2: mesmo prefixo em todas as linhas para filtro `pm2 logs | grep INVARIANT_BROKEN`
    console.error('[EVOLUTION][INVARIANT_BROKEN]');
    console.error(
      `[EVOLUTION][INVARIANT_BROKEN] external_id=${JSON.stringify(ext)} duplicate_row_count=${totalDup}`
    );
    console.error(`[EVOLUTION][INVARIANT_BROKEN] channels=${JSON.stringify(channels)}`);
    console.error(
      '[EVOLUTION][INVARIANT_BROKEN] hint=migration_011_idx_unique_evolution_external_id docs=backend/db/README.md'
    );
    fireEvolutionInvariantBrokenAlert({
      external_id: ext,
      duplicate_row_count: totalDup,
      channels,
    });
    return null;
  }
  return rows[0] ?? null;
}

/**
 * @deprecated Preferir findEvolutionChannelByExternalId (retorno único). Mantido para compatibilidade.
 */
export async function findEvolutionChannelsByExternalId(externalId) {
  const row = await findEvolutionChannelByExternalId(externalId);
  return row ? [row] : [];
}


export async function create({ tenantId, agentId, name, type, status, isActive, config }) {
  let tid = tenantId;
  if (tid == null && agentId) {
    const agentRow = await pool.query('SELECT tenant_id FROM agents WHERE id = $1', [agentId]).then(r => r.rows[0]);
    tid = agentRow?.tenant_id ?? null;
  }
  const { rows } = await pool.query(
    `INSERT INTO channels (tenant_id, agent_id, name, type, status, is_active)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, tenant_id, agent_id, name, type, status, is_active, message_count, created_at, updated_at`,
    [tid, agentId, name, type, status ?? 'offline', isActive !== false]
  );
  return rows[0];
}


export async function update(id, { name, type, status, isActive, config }) {
  const { rows } = await pool.query(
    `UPDATE channels SET
      name = COALESCE($2, name),
      type = COALESCE($3, type),
      status = COALESCE($4, status),
      is_active = COALESCE($5, is_active)
    WHERE id = $1 RETURNING id, tenant_id, agent_id, name, type, status, is_active, message_count, created_at, updated_at`,
    [id, name ?? null, type ?? null, status ?? null, isActive ?? null]
  );
  return rows[0] ?? null;
}


export async function incrementMessageCount(id) {
  await pool.query('UPDATE channels SET message_count = message_count + 1 WHERE id = $1', [id]);
}


export async function remove(id) {
  const { rowCount } = await pool.query('DELETE FROM channels WHERE id = $1', [id]);
  return rowCount > 0;
}
