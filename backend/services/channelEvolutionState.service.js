/**
 * Fonte de verdade: channels.connection_status (WhatsApp/Evolution).
 * Dual-write em channels.status (active/inactive) só por compatibilidade legada.
 *
 * Grafo local (ações internas / user / provision) — qualquer → error permitido:
 *   disconnected → connecting | disconnected
 *   connecting → connected | disconnected | connecting
 *   connected → disconnected | connecting | connected
 *   error → connecting | disconnected | connected | error
 * Bootstrap: disconnected → connected só com webhook + estado open (allowBootstrapOpen).
 * Estados observados na Evolution (webhook/sync/poll com trustRemoteState) aplicam-se mesmo fora do grafo.
 */

import * as channelRepo from '../repositories/channel.repository.js';

export const CONNECTION = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  ERROR: 'error',
};

/** @param {unknown} s */
export function normalizeConnectionStatus(s) {
  const t = String(s || '').trim().toLowerCase();
  if (['disconnected', 'connecting', 'connected', 'error'].includes(t)) return t;
  return CONNECTION.DISCONNECTED;
}

/** @param {string} conn */
export function legacyStatusFromConnection(conn) {
  return normalizeConnectionStatus(conn) === CONNECTION.CONNECTED ? 'active' : 'inactive';
}

/**
 * Regras de transição (evita saltos incoerentes).
 * Qualquer estado → error permitido (falha confirmada).
 * disconnected → connected só com bootstrap explícito (ex.: connection.update "open" sem histórico local).
 *
 * @param {string} from
 * @param {string} to
 * @param {{ source?: string, allowBootstrapOpen?: boolean }} [ctx]
 */
export function canTransitionConnectionStatus(from, to, ctx = {}) {
  const a = normalizeConnectionStatus(from);
  const b = normalizeConnectionStatus(to);
  if (a === b) return true;
  if (b === CONNECTION.ERROR) return true;

  const graph = {
    disconnected: new Set([CONNECTION.CONNECTING, CONNECTION.DISCONNECTED]),
    connecting: new Set([
      CONNECTION.CONNECTED,
      CONNECTION.DISCONNECTED,
      CONNECTION.CONNECTING,
    ]),
    connected: new Set([
      CONNECTION.DISCONNECTED,
      CONNECTION.CONNECTING,
      CONNECTION.CONNECTED,
    ]),
    error: new Set([
      CONNECTION.CONNECTING,
      CONNECTION.DISCONNECTED,
      CONNECTION.CONNECTED,
      CONNECTION.ERROR,
    ]),
  };

  const allowed = graph[a] || graph.disconnected;
  if (allowed.has(b)) return true;

  if (
    a === CONNECTION.DISCONNECTED &&
    b === CONNECTION.CONNECTED &&
    ctx.allowBootstrapOpen === true
  ) {
    return true;
  }

  return false;
}

/**
 * Atualização central: connection_status + status legado (active/inactive) + patch (config, external_id, …).
 * evolutionRaw não persiste coluna no banco; serve a log e allowBootstrapOpen.
 *
 * @param {object} p
 * @param {string} p.channelId
 * @param {string} p.tenantId
 * @param {object} [p.channelRow] — se omitido, carrega do banco
 * @param {string} p.nextConnectionStatus
 * @param {unknown} [p.evolutionRaw] — estado bruto Evolution (telemetria / bootstrap webhook)
 * @param {string} p.reason — obrigatório para auditoria em log
 * @param {string} [p.source] — webhook | sync | poll | user | provision
 * @param {object} [p.patch] — campos extras para updateConnection (last_error, config, external_id, connected_at, …)
 * @param {boolean} [p.force] — ignora grafo de transição
 * @param {boolean} [p.trustRemoteState] — estado observado na Evolution/webhook oficial; aplica mesmo se o grafo local bloquearia
 */
export async function transitionEvolutionChannelConnection(p) {
  const {
    channelId,
    tenantId,
    channelRow = null,
    nextConnectionStatus,
    evolutionRaw,
    reason,
    source = 'poll',
    patch = {},
    force = false,
    trustRemoteState = false,
  } = p;

  if (!reason || String(reason).trim() === '') {
    console.warn('[EVOLUTION] transition skipped: missing reason channel=%s', channelId);
    return { applied: false, reason: 'MISSING_REASON' };
  }

  const row = channelRow || (await channelRepo.findById(channelId, tenantId));
  if (!row) {
    console.warn('[EVOLUTION] transition skipped: channel not found channel=%s tenant=%s', channelId, tenantId);
    return { applied: false, reason: 'CHANNEL_NOT_FOUND' };
  }

  const prev = normalizeConnectionStatus(row.connection_status);
  const next = normalizeConnectionStatus(nextConnectionStatus);

  const rawLower =
    evolutionRaw != null && evolutionRaw !== undefined ? String(evolutionRaw).trim().toLowerCase() : '';
  const allowBootstrapOpen =
    source === 'webhook' && (rawLower === 'open' || rawLower === 'connected');

  if (
    !force &&
    !trustRemoteState &&
    !canTransitionConnectionStatus(prev, next, { source, allowBootstrapOpen })
  ) {
    console.warn(
      '[EVOLUTION] transition blocked channel=%s tenant=%s %s→%s motivo=%s source=%s',
      channelId,
      tenantId,
      prev,
      next,
      reason,
      source
    );
    return { applied: false, reason: 'TRANSITION_NOT_ALLOWED', prev, next };
  }

  const legacy = legacyStatusFromConnection(next);
  /** @type {Record<string, unknown>} */
  const data = { ...patch, status: legacy, connection_status: next };

  if (legacy === 'active' && next === CONNECTION.CONNECTED) {
    if (data.connected_at === undefined) data.connected_at = new Date();
    if (data.last_error === undefined) data.last_error = null;
  }

  const updated = await channelRepo.updateConnection(channelId, tenantId, data);

  console.log(
    '[EVOLUTION] transition channel=%s tenant=%s connection %s→%s legacy=%s motivo=%s source=%s evolution_raw=%s',
    channelId,
    tenantId,
    prev,
    next,
    legacy,
    reason,
    source,
    evolutionRaw === undefined ? '(unchanged)' : String(evolutionRaw)
  );

  return { applied: true, prev, next, channel: updated };
}
