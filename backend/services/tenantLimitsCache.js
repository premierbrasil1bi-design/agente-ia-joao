/**
 * Cache em memória dos contextos de limites por tenant (TTL curto para alinhar billing ↔ enforcement).
 */

const TTL_MS = 5000;

/** @type {Map<string, { data: object, expiresAt: number }>} */
const store = new Map();

function key(tenantId) {
  return String(tenantId || '').trim();
}

/**
 * @param {string} tenantId
 * @returns {object | null} payload do loadTenantLimitsContext ou null
 */
export function getTenantLimitsCached(tenantId) {
  const k = key(tenantId);
  if (!k) return null;
  const hit = store.get(k);
  if (!hit || hit.expiresAt <= Date.now()) {
    if (hit) store.delete(k);
    return null;
  }
  return hit.data;
}

/**
 * @param {string} tenantId
 * @param {object} data
 */
export function setTenantLimitsCache(tenantId, data) {
  const k = key(tenantId);
  if (!k) return;
  store.set(k, { data, expiresAt: Date.now() + TTL_MS });
}

/**
 * @param {string} tenantId
 */
export function invalidateTenantLimitsCache(tenantId) {
  store.delete(key(tenantId));
}
