import { findActiveChannels } from '../repositories/channel.repository.js';
import { resolveProvider } from '../providers/resolveProvider.js';
import { getAdapter, getProviderFallbackOrder } from '../providers/sessionAdapters/index.js';
import { resolveSessionName } from '../utils/resolveSessionName.js';
import { ensureSession } from './sessionOrchestrator.js';
import { incrementSessionMonitor } from './telemetry.service.js';
import { enqueueSessionRecovery } from '../queues/session.queue.js';

const BASE_INTERVAL = 30_000;
const MAX_ATTEMPTS_PER_MIN = 3;
const BASE_BACKOFF_MS = 10_000;
const MAX_BACKOFF_MS = 5 * 60_000;
const recoveryState = new Map();
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
      logEvent({
        event: 'SESSION_MONITOR_CHECK',
        channelId: channel.id,
        provider,
        sessionName,
        status: session?.status || 'UNKNOWN',
      });
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
