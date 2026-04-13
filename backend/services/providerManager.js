import * as wahaService from './wahaService.js';
import * as evolutionService from './evolutionService.js';
import {
  incrementMessage,
  incrementProvider,
} from './telemetry.service.js';
import { updateProviderMetrics } from './providerHealth.js';
import {
  registerMessage,
  markAsSent,
  markAsFailed,
  addAttempt,
} from './messageRegistry.js';

const DEFAULT_SESSION = 'default';
const DEFAULT_INSTANCE = 'default';
let activeRequests = 0;
const MAX_CONCURRENT = 5;
const queue = [];

function logEvent(event) {
  console.log(JSON.stringify({
    ...event,
    timestamp: new Date().toISOString(),
  }));
}

async function tryWithRetry(fn, retries = 2) {
  let lastError;
  const total = Number.isFinite(Number(retries)) ? Math.max(1, Number(retries)) : 2;
  for (let i = 0; i < total; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      console.warn(`Retry ${i + 1} falhou:`, err?.message || String(err));
    }
  }
  throw lastError;
}

function processQueue() {
  while (activeRequests < MAX_CONCURRENT && queue.length > 0) {
    const next = queue.shift();
    if (!next) continue;
    activeRequests += 1;
    next();
  }
}

async function waitForSlot() {
  if (activeRequests < MAX_CONCURRENT) {
    activeRequests += 1;
    return;
  }
  await new Promise((resolve) => {
    queue.push(resolve);
  });
}

function releaseSlot() {
  activeRequests = Math.max(0, activeRequests - 1);
  processQueue();
}

function resolveMessagePayload(payload = {}) {
  const number = String(payload?.number || '').trim();
  const text = String(payload?.text || '');
  return { number, text };
}

function resolveWahaSession(payload = {}) {
  return String(payload?.session || payload?.sessionName || DEFAULT_SESSION).trim() || DEFAULT_SESSION;
}

function resolveEvolutionInstance(payload = {}) {
  return String(payload?.instance || payload?.instanceName || DEFAULT_INSTANCE).trim() || DEFAULT_INSTANCE;
}

function normalizeStatusValue(raw) {
  if (typeof raw === 'string') return raw.toUpperCase();
  const candidate = raw?.status ?? raw?.state ?? raw?.instance?.state ?? raw?.session?.status ?? null;
  return candidate != null ? String(candidate).toUpperCase() : 'UNKNOWN';
}

function normalizeProviderStatus(providerName, rawStatus) {
  const status = String(rawStatus || '').toUpperCase();
  if (providerName === 'waha') {
    if (status === 'WORKING') return 'WORKING';
    if (status === 'STOPPED') return 'STOPPED';
    if (status === 'FAILED') return 'FAILED';
    return 'OFFLINE';
  }
  if (providerName === 'evolution') {
    if (status === 'WORKING' || status === 'OPEN' || status === 'CONNECTED') return 'WORKING';
    return 'OFFLINE';
  }
  return status || 'OFFLINE';
}

const providers = {
  waha: {
    async sendMessage(payload) {
      const { number, text } = resolveMessagePayload(payload);
      const session = resolveWahaSession(payload);
      const out = await wahaService.sendMessage(session, number, text);
      if (!out?.ok) throw new Error(out?.error || 'WAHA sendMessage failed');
      return out?.data ?? out;
    },
    async getStatus(payload = {}) {
      const session = resolveWahaSession(payload);
      const out = await wahaService.getSessionStatus(session);
      if (!out?.ok) throw new Error(out?.error || 'WAHA status unavailable');
      return normalizeStatusValue(out?.data);
    },
  },
  evolution: {
    async sendMessage(payload) {
      const { number, text } = resolveMessagePayload(payload);
      const instance = resolveEvolutionInstance(payload);
      return evolutionService.sendText(instance, number, text);
    },
    async getStatus(payload = {}) {
      const instance = resolveEvolutionInstance(payload);
      const out = await evolutionService.getStatus(instance);
      return normalizeStatusValue(out);
    },
  },
};

const priority = ['waha', 'evolution'];

export async function sendMessage(payload) {
  await waitForSlot();

  const messageId = payload?.messageId ? String(payload.messageId).trim() : '';
  try {
    logEvent({
      event: 'MESSAGE_RECEIVED',
      messageId: messageId || null,
      status: 'RECEIVED',
    });
    incrementMessage('received');

    const reg = registerMessage(messageId, payload);
    if (reg?.exists) {
      logEvent({
        event: 'MESSAGE_DUPLICATED',
        messageId: messageId || null,
        status: 'DUPLICATED',
      });
      incrementMessage('duplicated');
      return { duplicated: true };
    }

    const statusMap = await getProviderStatus(payload);
    const preferred = getBestProvider(statusMap);
    const dynamicPriority = preferred
      ? [preferred, ...priority.filter((p) => p !== preferred)]
      : priority;
    if (preferred && preferred !== priority[0]) {
      logEvent({
        event: 'PROVIDER_SWITCH',
        messageId: messageId || null,
        provider: preferred,
        status: 'SWITCHED',
      });
    }

    for (const providerName of dynamicPriority) {
      const provider = providers[providerName];

      try {
        if (messageId) {
          addAttempt(messageId, {
            provider: providerName,
            type: 'ATTEMPT',
            timestamp: new Date().toISOString(),
          });
        }
        logEvent({
          event: 'MESSAGE_SEND_ATTEMPT',
          provider: providerName,
          messageId: messageId || null,
          status: 'ATTEMPT',
        });
        const start = Date.now();
        const result = await tryWithRetry(() => provider.sendMessage(payload), 2);
        const latency = Date.now() - start;
        updateProviderMetrics(providerName, latency, true);
        incrementProvider(providerName, 'success');
        logEvent({
          event: 'MESSAGE_SUCCESS',
          provider: providerName,
          latency,
          messageId: messageId || null,
          status: 'SUCCESS',
        });
        if (messageId) {
          addAttempt(messageId, {
            provider: providerName,
            type: 'SUCCESS',
            latency,
            timestamp: new Date().toISOString(),
          });
          markAsSent(messageId, providerName);
        }
        incrementMessage('sent');
        return result;
      } catch (err) {
        updateProviderMetrics(providerName, null, false);
        incrementProvider(providerName, 'failure');
        if (messageId) {
          addAttempt(messageId, {
            provider: providerName,
            type: 'ERROR',
            error: err?.message || String(err),
            timestamp: new Date().toISOString(),
          });
        }
        logEvent({
          event: 'MESSAGE_FAILED',
          provider: providerName,
          error: err?.message || String(err),
          messageId: messageId || null,
          status: 'ERROR',
        });
      }
    }

    if (messageId) markAsFailed(messageId, 'Todos providers falharam');
    incrementMessage('failed');
    throw new Error('❌ Todos providers falharam');
  } finally {
    releaseSlot();
  }
}

export async function getProviderStatus(payload = {}) {
  const status = {};

  for (const name of Object.keys(providers)) {
    try {
      const raw = await providers[name].getStatus(payload);
      status[name] = normalizeProviderStatus(name, raw);
    } catch (err) {
      status[name] = 'OFFLINE';
    }
  }

  return status;
}

export function getBestProvider(statusMap) {
  for (const name of priority) {
    if (String(statusMap?.[name] || '').toUpperCase() === 'WORKING') {
      return name;
    }
  }
  return null;
}

export function getProviderRuntimeMetrics() {
  return {
    activeRequests,
    maxConcurrent: MAX_CONCURRENT,
    queueSize: queue.length,
  };
}

export { providers, priority };
