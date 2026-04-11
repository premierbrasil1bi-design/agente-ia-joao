/** @typedef {{ timestamp: string, channels: object, queue: object, providers: object }} MonitoringSnapshot */

const MAX_SNAPSHOTS = 60;

/** @type {Map<string, MonitoringSnapshot[]>} */
const byTenant = new Map();

/**
 * Extrai apenas os campos do contrato de snapshot a partir do retorno de getSystemMetrics.
 * @param {object|null|undefined} metrics
 * @returns {MonitoringSnapshot | null}
 */
export function snapshotFromMetrics(metrics) {
  if (!metrics || typeof metrics !== 'object') return null;
  return {
    timestamp: String(metrics.timestamp || new Date().toISOString()),
    channels: {
      total: Number(metrics.channels?.total ?? 0),
      connected: Number(metrics.channels?.connected ?? 0),
      error: Number(metrics.channels?.error ?? 0),
      waiting: Number(metrics.channels?.waiting ?? 0),
      connecting: Number(metrics.channels?.connecting ?? 0),
    },
    queue: {
      waiting: Number(metrics.queue?.waiting ?? 0),
      active: Number(metrics.queue?.active ?? 0),
      failed: Number(metrics.queue?.failed ?? 0),
      completed: Number(metrics.queue?.completed ?? 0),
    },
    providers: {
      waha: String(metrics.providers?.waha ?? 'CLOSED'),
      evolution: String(metrics.providers?.evolution ?? 'CLOSED'),
    },
  };
}

function snapshotsEqual(a, b) {
  if (!a || !b) return false;
  return (
    a.timestamp === b.timestamp &&
    a.channels?.connected === b.channels?.connected &&
    a.channels?.error === b.channels?.error &&
    a.queue?.waiting === b.queue?.waiting
  );
}

/**
 * @param {string|null|undefined} tenantId
 * @param {MonitoringSnapshot} snapshot
 * @returns {boolean} true se o buffer foi alterado
 */
export function addSnapshot(tenantId, snapshot) {
  const key = String(tenantId || '').trim();
  if (!key || !snapshot?.timestamp) return false;

  const list = byTenant.get(key) ? [...byTenant.get(key)] : [];
  const last = list[list.length - 1];
  if (last && last.timestamp === snapshot.timestamp) {
    if (snapshotsEqual(last, snapshot)) return false;
    list[list.length - 1] = snapshot;
  } else {
    list.push(snapshot);
  }
  while (list.length > MAX_SNAPSHOTS) list.shift();
  byTenant.set(key, list);
  return true;
}

/**
 * @param {string|null|undefined} tenantId
 * @param {number} [limit]
 * @returns {MonitoringSnapshot[]}
 */
export function getSnapshots(tenantId, limit = 30) {
  const key = String(tenantId || '').trim();
  if (!key) return [];
  const list = byTenant.get(key) || [];
  const n = Math.min(Math.max(1, Number(limit) || 30), MAX_SNAPSHOTS);
  return list.slice(-n);
}

/**
 * @param {string|null|undefined} tenantId
 * @returns {MonitoringSnapshot | null}
 */
export function getLatestSnapshot(tenantId) {
  const key = String(tenantId || '').trim();
  if (!key) return null;
  const list = byTenant.get(key) || [];
  return list[list.length - 1] || null;
}
