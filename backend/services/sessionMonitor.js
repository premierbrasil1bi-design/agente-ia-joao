import { findActiveChannels } from '../repositories/channel.repository.js';
import { resolveProvider } from '../providers/resolveProvider.js';
import { getAdapter, getProviderFallbackOrder } from '../providers/sessionAdapters/index.js';
import { resolveSessionName } from '../utils/resolveSessionName.js';
import { ensureSession } from './sessionOrchestrator.js';
import { incrementSessionMonitor } from './telemetry.service.js';
import { enqueueSessionRecovery } from '../queues/session.queue.js';
import { syncChannelSessionFromAdapter } from './channelSessionRealtimeSync.service.js';
import { normalizeSessionStatus, SESSION_CANONICAL } from '../utils/normalizeSessionStatus.js';
import { normalizeConnectionStatus, CONNECTION } from './channelEvolutionState.service.js';

const BASE_INTERVAL = 30_000;
const MAX_ATTEMPTS_PER_MIN = 3;
const BASE_BACKOFF_MS = 10_000;
const MAX_BACKOFF_MS = 5 * 60_000;
const recoveryState = new Map();
/** @type {Map<string, { status: string, qrKey: string, error: string|null, provider: string }>} */
const lastMonitorSnapshot = new Map();

const STALE_LAST_SEEN_MS = Number(process.env.CHANNEL_LAST_SEEN_STALE_MS || 900000);

function monitorQrFingerprint(qr) {
  if (qr == null) return '';
  const s = typeof qr === 'string' ? qr : String(qr);
  return s.length > 96 ? s.slice(0, 96) : s;
}

let monitorState = {
  lastRunAt: null,
  lastDurationMs: 0,
  lastChecked: 0,
  lastRecovered: 0,
};
let monitorRunning = false;

function logEvent(event) {
  console.log(JSON.stringify({ ...event, timestamp: new Date().toISOString() }));
}

function recoveryKey(provider, sessionName) {
  return `${String(provider || 'unknown').toLowerCase()}:${String(sessionName || '').trim()}`;
}

function resolveChannelSessionName(channel, provider) {
  if (String(provider || '').toLowerCase() === 'waha') return resolveSessionName(channel);
  return (
    String(channel?.external_id || '').trim() ||
    String(channel?.instance || '').trim() ||
    String(channel?.id || '').trim() ||
    'default'
  );
}

function shouldRecover(provider, sessionName) {
  const key = recoveryKey(provider, sessionName);
  const now = Date.now();
  const current = recoveryState.get(key) || { attemptsWindowStart: now, attemptsInWindow: 0, nextAllowedAt: 0 };
  if (now - current.attemptsWindowStart > 60_000) {
    current.attemptsWindowStart = now;
    current.attemptsInWindow = 0;
  }
  if (current.attemptsInWindow >= MAX_ATTEMPTS_PER_MIN) return false;
  if (current.nextAllowedAt > now) return false;
  return true;
}

function registerAttempt(provider, sessionName, success) {
  const key = recoveryKey(provider, sessionName);
  const now = Date.now();
  const current = recoveryState.get(key) || { attemptsWindowStart: now, attemptsInWindow: 0, nextAllowedAt: 0, failures: 0 };
  if (now - current.attemptsWindowStart > 60_000) {
    current.attemptsWindowStart = now;
    current.attemptsInWindow = 0;
  }
  current.attemptsInWindow += 1;
  if (success) {
    current.failures = 0;
    current.nextAllowedAt = now;
  } else {
    current.failures = (current.failures || 0) + 1;
    const backoff = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * current.failures);
    current.nextAllowedAt = now + backoff;
  }
  recoveryState.set(key, current);
}

function needsRecovery(status) {
  const s = String(status || '').toUpperCase();
  return s === 'OFFLINE' || s === 'FAILED' || s === 'STOPPED';
}

async function recoverWithFailover(provider, sessionName, channel = null) {
  const order = getProviderFallbackOrder(provider);
  let lastError = null;
  for (let i = 0; i < order.length; i += 1) {
    const currentProvider = order[i];
    try {
      if (i > 0) {
        incrementSessionMonitor('failovers');
        logEvent({
          event: 'SESSION_FAILOVER',
          from: order[i - 1],
          to: currentProvider,
          sessionName,
        });
      }
      incrementSessionMonitor('reconnectionAttempts');
      try {
        const queued = await enqueueSessionRecovery({
          provider: currentProvider,
          sessionName,
          channelId: channel?.id ?? null,
          tenantId: channel?.tenant_id ?? null,
        });
        return {
          providerUsed: currentProvider,
          status: 'QUEUED',
          queued: Boolean(queued?.queued),
          jobId: queued?.jobId ?? null,
        };
      } catch {
        return await ensureSession({
          provider: currentProvider,
          sessionName,
          channelId: channel?.id ?? null,
          tenantId: channel?.tenant_id ?? null,
        });
      }
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('Falha ao recuperar sessão');
}

export async function checkSessions() {
  const start = Date.now();
  monitorState.lastChecked = 0;
  monitorState.lastRecovered = 0;
  const channels = await findActiveChannels();
  for (const channel of channels) {
    const provider = String(resolveProvider(channel) || '').toLowerCase();
    if (!provider) continue;
    let sessionName = '';
    try {
      sessionName = resolveChannelSessionName(channel, provider);
    } catch {
      continue;
    }
    if (!sessionName) continue;
    monitorState.lastChecked += 1;

    try {
      const adapter = getAdapter(provider);
      const session = await adapter.getSession(sessionName);
      const adapterStatus = session?.status || 'OFFLINE';
      let qr = null;
      if (String(adapterStatus).toUpperCase() === 'QR' && typeof adapter.getQRCode === 'function') {
        try {
          qr = await adapter.getQRCode(sessionName);
        } catch {
          qr = null;
        }
      }

      logEvent({
        event: 'SESSION_MONITOR_CHECK',
        channelId: channel.id,
        provider,
        sessionName,
        status: adapterStatus,
        hasQr: Boolean(qr),
      });

      const canonical = normalizeSessionStatus(provider, adapterStatus);
      const nextSnap = {
        status: adapterStatus,
        qrKey: monitorQrFingerprint(qr),
        error: null,
        provider,
      };
      const prevSnap = lastMonitorSnapshot.get(String(channel.id));
      const snapChanged =
        !prevSnap ||
        prevSnap.status !== nextSnap.status ||
        prevSnap.qrKey !== nextSnap.qrKey ||
        prevSnap.error !== nextSnap.error ||
        prevSnap.provider !== nextSnap.provider;

      const conn = normalizeConnectionStatus(channel.connection_status);
      const lastSeenMs = channel.last_seen_at ? new Date(channel.last_seen_at).getTime() : 0;
      const staleConnected =
        conn === CONNECTION.CONNECTED &&
        lastSeenMs > 0 &&
        Date.now() - lastSeenMs > STALE_LAST_SEEN_MS &&
        canonical !== SESSION_CANONICAL.CONNECTED;

      const forceStaleSync = staleConnected;
      const missingSession = session && session.exists === false;

      if (snapChanged || forceStaleSync || missingSession) {
        const statusForSync =
          forceStaleSync || missingSession ? 'OFFLINE' : adapterStatus;
        try {
          await syncChannelSessionFromAdapter({
            channel,
            provider,
            sessionName,
            adapterStatus: statusForSync,
            qr: forceStaleSync || missingSession ? null : qr,
            error: null,
            source: forceStaleSync ? 'session_monitor_stale' : 'session_monitor',
          });
        } catch {
          /* sync best-effort */
        }
      }

      const snapToStore =
        forceStaleSync || missingSession
          ? { status: 'OFFLINE', qrKey: '', error: null, provider }
          : nextSnap;
      lastMonitorSnapshot.set(String(channel.id), snapToStore);

      if (!needsRecovery(session?.status)) {
        registerAttempt(provider, sessionName, true);
        continue;
      }
      if (!shouldRecover(provider, sessionName)) continue;

      logEvent({
        event: 'SESSION_RECOVERY_START',
        channelId: channel.id,
        provider,
        sessionName,
      });
      const recovered = await recoverWithFailover(provider, sessionName, channel);
      incrementSessionMonitor('recoverySuccess');
      monitorState.lastRecovered += 1;
      registerAttempt(provider, sessionName, true);
      logEvent({
        event: 'SESSION_RECOVERY_SUCCESS',
        channelId: channel.id,
        providerUsed: recovered?.providerUsed || provider,
        sessionName,
        status: recovered?.status || 'UNKNOWN',
      });
    } catch (err) {
      registerAttempt(provider, sessionName, false);
      logEvent({
        event: 'SESSION_RECOVERY_FAIL',
        channelId: channel.id,
        provider,
        sessionName,
        error: err?.message || String(err),
      });
      try {
        await syncChannelSessionFromAdapter({
          channel,
          provider,
          sessionName,
          adapterStatus: 'OFFLINE',
          qr: null,
          error: err?.message || String(err),
          source: 'session_monitor_error',
        });
      } catch {
        /* ignore */
      }
      lastMonitorSnapshot.set(String(channel.id), {
        status: 'OFFLINE',
        qrKey: '',
        error: err?.message || String(err),
        provider,
      });
    }
  }
  monitorState.lastRunAt = new Date().toISOString();
  monitorState.lastDurationMs = Date.now() - start;
}

export async function getSessionMonitorDebug() {
  const channels = await findActiveChannels();
  const providerStatus = {};
  const sessions = [];
  for (const channel of channels) {
    const provider = String(resolveProvider(channel) || '').toLowerCase();
    if (!provider) continue;
    let sessionName = '';
    try {
      sessionName = resolveChannelSessionName(channel, provider);
    } catch {
      continue;
    }
    try {
      const adapter = getAdapter(provider);
      const session = await adapter.getSession(sessionName);
      const status = String(session?.status || 'UNKNOWN').toUpperCase();
      sessions.push({
        channelId: channel.id,
        provider,
        sessionName,
        status,
      });
      providerStatus[provider] = providerStatus[provider] || { WORKING: 0, QR: 0, OFFLINE: 0, UNKNOWN: 0 };
      if (!providerStatus[provider][status]) providerStatus[provider][status] = 0;
      providerStatus[provider][status] += 1;
    } catch {
      sessions.push({
        channelId: channel.id,
        provider,
        sessionName,
        status: 'OFFLINE',
      });
      providerStatus[provider] = providerStatus[provider] || { WORKING: 0, QR: 0, OFFLINE: 0, UNKNOWN: 0 };
      providerStatus[provider].OFFLINE += 1;
    }
  }

  const backoffSessions = Array.from(recoveryState.entries()).map(([key, value]) => ({
    key,
    attemptsInWindow: value.attemptsInWindow,
    failures: value.failures || 0,
    nextAllowedAt: value.nextAllowedAt || 0,
  }));

  return {
    sessions,
    backoff: backoffSessions,
    metrics: {
      statusByProvider: providerStatus,
      trackedRecoveryKeys: recoveryState.size,
      intervalMs: BASE_INTERVAL,
    },
  };
}

export function getSessionMonitorState() {
  return { ...monitorState };
}

export function startSessionMonitor() {
  const interval = setInterval(() => {
    const jitter = Math.floor(Math.random() * 5000);
    setTimeout(() => {
      if (monitorRunning) return;
      monitorRunning = true;
      checkSessions()
        .catch((err) => {
          logEvent({
            event: 'SESSION_MONITOR_CHECK',
            status: 'ERROR',
            error: err?.message || String(err),
          });
        })
        .finally(() => {
          monitorRunning = false;
        });
    }, jitter);
  }, BASE_INTERVAL);
  if (typeof interval.unref === 'function') interval.unref();
  monitorRunning = true;
  checkSessions().catch(() => {}).finally(() => {
    monitorRunning = false;
  });
  return interval;
}
