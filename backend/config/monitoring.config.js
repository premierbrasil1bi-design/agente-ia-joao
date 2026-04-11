function parseNonNegInt(name, defaultVal) {
  const v = process.env[name];
  if (v == null || String(v).trim() === '') return defaultVal;
  const n = parseInt(String(v), 10);
  if (!Number.isFinite(n) || n < 0) return defaultVal;
  return n;
}

/** TTL da chave de estado por canal (renovado a cada update). Default 24h. */
export const CHANNEL_STATE_TTL_SECONDS = parseNonNegInt('MONITORING_CHANNEL_STATE_TTL_SECONDS', 86_400);

/** TTL da lista de snapshots por tenant. Default 2h (configurável até 6h+ via env). */
export const SNAPSHOT_TTL_SECONDS = parseNonNegInt('MONITORING_SNAPSHOT_TTL_SECONDS', 7200);

/**
 * Limite opcional de canais indexados por tenant no Redis (0 = sem limite, só observabilidade).
 * Ao ultrapassar, apenas log TENANT_CHANNEL_LIMIT_EXCEEDED; não bloqueia escrita.
 */
export const MAX_CHANNELS_PER_TENANT = parseNonNegInt('MONITORING_MAX_CHANNELS_PER_TENANT', 0);
