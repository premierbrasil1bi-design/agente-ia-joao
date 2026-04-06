/**
 * Métricas leves de QR WAHA + janela deslizante para instabilidade global.
 */

import { openCircuit, isCircuitOpen } from './wahaCircuitBreaker.service.js';

const metrics = {
  qrRequests: 0,
  qrSuccess: 0,
  qrPending: 0,
  qrFailures: 0,
  unstable: 0,
  offline: 0,
  lastDuration: 0,
};

const UNSTABLE_WINDOW_MS =
  Number.parseInt(process.env.WAHA_UNSTABLE_WINDOW_MS || '', 10) || 5 * 60 * 1000;
const UNSTABLE_THRESHOLD =
  Number.parseInt(process.env.WAHA_UNSTABLE_THRESHOLD || '', 10) || 5;

/** @type {number[]} timestamps de eventos UNSTABLE */
const unstableTimestamps = [];

let lastGlobalInstabilityLogAt = 0;
const GLOBAL_INSTABILITY_LOG_COOLDOWN_MS = 60_000;

let lastCriticalLogAt = 0;
const CRITICAL_LOG_COOLDOWN_MS = 60_000;

function pruneUnstableWindow(now = Date.now()) {
  const cutoff = now - UNSTABLE_WINDOW_MS;
  while (unstableTimestamps.length > 0 && unstableTimestamps[0] < cutoff) {
    unstableTimestamps.shift();
  }
}

function checkGlobalInstability() {
  const now = Date.now();
  pruneUnstableWindow(now);
  if (unstableTimestamps.length > UNSTABLE_THRESHOLD) {
    openCircuit();
    if (now - lastGlobalInstabilityLogAt >= GLOBAL_INSTABILITY_LOG_COOLDOWN_MS) {
      lastGlobalInstabilityLogAt = now;
      console.warn('[WAHA] GLOBAL INSTABILITY DETECTED');
    }
  }
}

/**
 * Duração do último fluxo getQrCode concluído + alerta de lentidão.
 * @param {number} durationMs
 */
export function recordQrFlowDurationMs(durationMs) {
  const d = Number.isFinite(durationMs) ? Math.max(0, Math.floor(durationMs)) : 0;
  metrics.lastDuration = d;
  if (d > 10_000) {
    console.log('[WAHA] SLOW RESPONSE DETECTED');
  }
}

export function checkCriticalMetricsState() {
  const unstableLimit = UNSTABLE_THRESHOLD * 2;
  if (metrics.offline > 5 || metrics.unstable > unstableLimit) {
    const now = Date.now();
    if (now - lastCriticalLogAt >= CRITICAL_LOG_COOLDOWN_MS) {
      lastCriticalLogAt = now;
      console.warn('[WAHA] CRITICAL STATE DETECTED');
    }
  }
}

export function trackQrRequest() {
  metrics.qrRequests += 1;
}

export function trackQrSuccess() {
  metrics.qrSuccess += 1;
}

export function trackQrPending() {
  metrics.qrPending += 1;
}

export function trackQrFailure() {
  metrics.qrFailures += 1;
}

export function trackUnstable() {
  metrics.unstable += 1;
  unstableTimestamps.push(Date.now());
  checkGlobalInstability();
  checkCriticalMetricsState();
}

export function trackOffline() {
  metrics.offline += 1;
  checkCriticalMetricsState();
}

export function getWahaMetrics() {
  return { ...metrics };
}

/**
 * Contagem de eventos UNSTABLE dentro da janela deslizante (útil para painel).
 */
export function getUnstableWindowCount() {
  pruneUnstableWindow();
  return unstableTimestamps.length;
}

/**
 * Status agregado para GET /api/internal/waha/status
 */
export function getWahaGlobalStatus() {
  const circuitOpen = isCircuitOpen();
  const unstableCount = metrics.unstable;
  const offlineCount = metrics.offline;
  const lastDuration = metrics.lastDuration;
  const unstableLimit = UNSTABLE_THRESHOLD * 2;

  pruneUnstableWindow();
  const windowUnstable = unstableTimestamps.length;

  let status = 'healthy';
  if (circuitOpen || offlineCount > 5 || unstableCount > unstableLimit) {
    status = 'down';
  } else if (lastDuration > 10_000 || windowUnstable > UNSTABLE_THRESHOLD) {
    status = 'degraded';
  }

  return {
    circuitOpen,
    unstableCount,
    offlineCount,
    lastDuration,
    status,
  };
}
