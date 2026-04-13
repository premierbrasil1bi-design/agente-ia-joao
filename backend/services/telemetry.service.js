const telemetry = {
  messages: {
    received: 0,
    sent: 0,
    failed: 0,
    duplicated: 0,
  },
  providers: {
    waha: { success: 0, failure: 0 },
    evolution: { success: 0, failure: 0 },
  },
  registry: {
    cleanupRuns: 0,
    cleanedMessages: 0,
    evictions: 0,
  },
  system: {
    startedAt: Date.now(),
  },
};
const snapshots = [];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function incrementMessage(type) {
  const key = String(type || '').toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(telemetry.messages, key)) return;
  telemetry.messages[key] += 1;
}

export function incrementProvider(provider, type) {
  const providerKey = String(provider || '').toLowerCase();
  const typeKey = String(type || '').toLowerCase();
  if (!telemetry.providers[providerKey]) {
    telemetry.providers[providerKey] = { success: 0, failure: 0 };
  }
  if (!Object.prototype.hasOwnProperty.call(telemetry.providers[providerKey], typeKey)) return;
  telemetry.providers[providerKey][typeKey] += 1;
}

export function incrementCleanup(removedCount) {
  telemetry.registry.cleanupRuns += 1;
  const removed = Number.isFinite(Number(removedCount)) ? Math.max(0, Number(removedCount)) : 0;
  telemetry.registry.cleanedMessages += removed;
}

export function incrementEviction() {
  telemetry.registry.evictions += 1;
}

export function getTelemetry() {
  return clone(telemetry);
}

export function snapshotTelemetry(metadata = {}) {
  const snapshot = {
    data: clone(telemetry),
    timestamp: new Date().toISOString(),
    meta: {
      requestedBy: metadata?.requestedBy || 'unknown',
      ip: metadata?.ip || 'unknown',
      userAgent: metadata?.userAgent || 'unknown',
    },
  };
  snapshots.push(snapshot);
  if (snapshots.length > 20) snapshots.shift();
  console.log(JSON.stringify({ event: 'TELEMETRY_SNAPSHOT', timestamp: snapshot.timestamp }));
  return snapshot;
}

export function resetTelemetry(metadata = {}) {
  const snapshot = snapshotTelemetry(metadata);
  telemetry.messages = {
    received: 0,
    sent: 0,
    failed: 0,
    duplicated: 0,
  };
  telemetry.providers = {
    waha: { success: 0, failure: 0 },
    evolution: { success: 0, failure: 0 },
  };
  telemetry.registry = {
    cleanupRuns: 0,
    cleanedMessages: 0,
    evictions: 0,
  };
  telemetry.system.startedAt = Date.now();
  console.log(JSON.stringify({ event: 'TELEMETRY_RESET', timestamp: new Date().toISOString() }));
  return snapshot;
}

export function getSnapshots() {
  return clone(snapshots);
}
