/**
 * Sincroniza estado de sessão WhatsApp: persistência (connection_status) + Socket.IO padronizado,
 * com deduplicação de emissão quando status canônico não muda.
 */

import {
  CONNECTION,
  transitionEvolutionChannelConnection,
  normalizeConnectionStatus,
} from './channelEvolutionState.service.js';
import { emitChannelEvent } from '../utils/channelRealtime.js';
import { normalizeSessionStatus, SESSION_CANONICAL } from '../utils/normalizeSessionStatus.js';

/** @type {Map<string, { canonical: string, qrKey: string }>} */
const lastEmitted = new Map();

function logStructured(event, extra = {}) {
  console.log(JSON.stringify({ event, timestamp: new Date().toISOString(), ...extra }));
}

function canonicalToConnection(canonical) {
  switch (canonical) {
    case SESSION_CANONICAL.CONNECTED:
      return CONNECTION.CONNECTED;
    case SESSION_CANONICAL.FAILED:
      return CONNECTION.ERROR;
    case SESSION_CANONICAL.DISCONNECTED:
      return CONNECTION.DISCONNECTED;
    case SESSION_CANONICAL.QR_READY:
    case SESSION_CANONICAL.CONNECTING:
    default:
      return CONNECTION.CONNECTING;
  }
}

function qrFingerprint(qr) {
  if (qr == null) return '';
  const s = typeof qr === 'string' ? qr : String(qr);
  return s.length > 96 ? s.slice(0, 96) : s;
}

function buildPayload(channel, provider, sessionName, canonical, qr, error, extras = {}) {
  return {
    channelId: channel.id,
    tenantId: channel.tenant_id,
    provider: String(provider || channel.provider || '').toLowerCase() || null,
    sessionName: sessionName || null,
    status: canonical,
    qr: qr ?? null,
    error: error ?? null,
    timestamp: new Date().toISOString(),
    ...extras,
  };
}

function emitSocketBatch(payload, { includeQr, includeConnected, includeDisconnected, includeError }) {
  const events = ['channel:status'];
  if (includeQr) events.push('channel:qr');
  if (includeConnected) events.push('channel:connected');
  if (includeDisconnected) events.push('channel:disconnected');
  if (includeError) events.push('channel:error');

  for (const ev of events) {
    emitChannelEvent(ev, payload);
  }
  logStructured('CHANNEL_SOCKET_EMIT', {
    channelId: payload.channelId,
    tenantId: payload.tenantId,
    events,
    status: payload.status,
  });
  if (includeError) {
    logStructured('CHANNEL_ERROR', {
      channelId: payload.channelId,
      tenantId: payload.tenantId,
      status: payload.status,
      error: payload.error,
    });
  }
}

function logSessionMonitorSync(channel, source, out) {
  if (!String(source || '').startsWith('session_monitor') || !channel?.id) return;
  logStructured('SESSION_MONITOR_SYNC', {
    channelId: channel?.id,
    tenantId: channel?.tenant_id,
    skipped: Boolean(out?.skipped),
    reason: out?.reason ?? null,
    canonical: out?.canonical ?? null,
    source,
  });
}

/**
 * Persiste estado observado no adapter + emite sockets (dedupe por status/QR).
 * @param {object} opts
 * @param {object} opts.channel — linha do canal (id, tenant_id, connection_status, …)
 * @param {string} opts.provider
 * @param {string} opts.sessionName
 * @param {string} [opts.adapterStatus] — WORKING | QR | OFFLINE | etc.
 * @param {string|null} [opts.qr]
 * @param {string|null} [opts.error]
 * @param {string} [opts.source]
 */
export async function syncChannelSessionFromAdapter({
  channel,
  provider,
  sessionName,
  adapterStatus,
  qr = null,
  error = null,
  source = 'session_monitor',
}) {
  if (!channel?.id || !channel?.tenant_id) {
    const out = { skipped: true, reason: 'NO_CHANNEL' };
    logSessionMonitorSync(channel, source, out);
    return out;
  }

  const canonical = normalizeSessionStatus(provider, adapterStatus);

  const qk = qrFingerprint(qr);
  const key = String(channel.id);

  const nextConn = canonicalToConnection(canonical);
  const current = normalizeConnectionStatus(channel.connection_status);

  if (current !== nextConn || canonical === SESSION_CANONICAL.FAILED) {
    const tr = await transitionEvolutionChannelConnection({
      channelId: channel.id,
      tenantId: channel.tenant_id,
      channelRow: channel,
      nextConnectionStatus: nextConn,
      evolutionRaw: adapterStatus,
      reason: `sync: adapter session (${source})`,
      source: source === 'session_monitor' ? 'sync' : source,
      trustRemoteState: true,
      patch:
        canonical === SESSION_CANONICAL.FAILED && error
          ? { last_error: String(error).slice(0, 2000) }
          : canonical === SESSION_CANONICAL.CONNECTED
            ? { last_error: null }
            : {},
    });
    if (tr?.channel) {
      Object.assign(channel, tr.channel);
    }
    logStructured('CHANNEL_STATUS_SYNC', {
      channelId: channel.id,
      tenantId: channel.tenant_id,
      from: current,
      to: nextConn,
      canonical,
      source,
    });
  }

  const prev = lastEmitted.get(key);
  if (prev && prev.canonical === canonical && prev.qrKey === qk && !error) {
    const out = { skipped: true, reason: 'UNCHANGED_EMIT', canonical };
    logSessionMonitorSync(channel, source, out);
    return out;
  }

  if (canonical === SESSION_CANONICAL.CONNECTED) {
    logStructured('CHANNEL_CONNECTED', { channelId: channel.id, tenantId: channel.tenant_id, source });
  } else if (canonical === SESSION_CANONICAL.QR_READY) {
    logStructured('CHANNEL_QR_READY', { channelId: channel.id, tenantId: channel.tenant_id, source });
  } else if (canonical === SESSION_CANONICAL.DISCONNECTED) {
    logStructured('CHANNEL_DISCONNECTED', { channelId: channel.id, tenantId: channel.tenant_id, source });
  } else if (canonical === SESSION_CANONICAL.FAILED) {
    logStructured('CHANNEL_STATUS_CHANGED', {
      channelId: channel.id,
      tenantId: channel.tenant_id,
      canonical,
      source,
    });
  } else {
    logStructured('CHANNEL_STATUS_CHANGED', {
      channelId: channel.id,
      tenantId: channel.tenant_id,
      canonical,
      source,
    });
  }

  const payload = buildPayload(channel, provider, sessionName, canonical, qr, error, {});

  emitSocketBatch(payload, {
    includeQr: canonical === SESSION_CANONICAL.QR_READY && Boolean(qr),
    includeConnected: canonical === SESSION_CANONICAL.CONNECTED,
    includeDisconnected: canonical === SESSION_CANONICAL.DISCONNECTED,
    includeError: canonical === SESSION_CANONICAL.FAILED || Boolean(error),
  });

  lastEmitted.set(key, { canonical, qrKey: qk });
  const syncOut = { skipped: false, canonical };
  logSessionMonitorSync(channel, source, syncOut);
  return syncOut;
}

/**
 * Após webhook ou transição já aplicada: apenas emite sockets com dedupe (sem persistir de novo).
 * @param {object} opts
 * @param {object} opts.channel — canal já atualizado no banco
 * @param {string} opts.provider
 * @param {string} opts.sessionName
 * @param {string} opts.connectionStatus — connecting | connected | disconnected | error
 * @param {unknown} [opts.evolutionRaw]
 * @param {string|null} [opts.qr]
 * @param {string} opts.source
 * @param {Record<string, unknown>} [opts.socketExtras] — campos extras no payload (ex.: state WAHA, correlationId).
 */
export function publishChannelSessionAfterPersist({
  channel,
  provider,
  sessionName,
  connectionStatus,
  evolutionRaw = null,
  qr = null,
  source = 'webhook',
  socketExtras = {},
}) {
  if (!channel?.id || !channel?.tenant_id) return { skipped: true };

  const conn = normalizeConnectionStatus(connectionStatus);
  let canonical = SESSION_CANONICAL.CONNECTING;
  if (conn === CONNECTION.CONNECTED) canonical = SESSION_CANONICAL.CONNECTED;
  else if (conn === CONNECTION.DISCONNECTED) canonical = SESSION_CANONICAL.DISCONNECTED;
  else if (conn === CONNECTION.ERROR) canonical = SESSION_CANONICAL.FAILED;
  else {
    const raw = String(evolutionRaw || '').toLowerCase();
    if (raw === 'qr' || raw.includes('scan_qr')) canonical = SESSION_CANONICAL.QR_READY;
  }

  const qk = qrFingerprint(qr);
  const key = String(channel.id);
  const prev = lastEmitted.get(key);
  const errMsg =
    canonical === SESSION_CANONICAL.FAILED ? channel.last_error ?? null : null;
  if (prev && prev.canonical === canonical && prev.qrKey === qk && !errMsg) {
    return { skipped: true, reason: 'UNCHANGED' };
  }

  if (canonical === SESSION_CANONICAL.CONNECTED) {
    logStructured('CHANNEL_CONNECTED', { channelId: channel.id, tenantId: channel.tenant_id, source });
  } else if (canonical === SESSION_CANONICAL.QR_READY) {
    logStructured('CHANNEL_QR_READY', { channelId: channel.id, tenantId: channel.tenant_id, source });
  } else if (canonical === SESSION_CANONICAL.DISCONNECTED) {
    logStructured('CHANNEL_DISCONNECTED', { channelId: channel.id, tenantId: channel.tenant_id, source });
  } else {
    logStructured('CHANNEL_STATUS_CHANGED', {
      channelId: channel.id,
      tenantId: channel.tenant_id,
      canonical,
      source,
    });
  }

  const payload = buildPayload(channel, provider, sessionName, canonical, qr, errMsg, socketExtras);
  emitSocketBatch(payload, {
    includeQr: canonical === SESSION_CANONICAL.QR_READY && Boolean(qr),
    includeConnected: canonical === SESSION_CANONICAL.CONNECTED,
    includeDisconnected: canonical === SESSION_CANONICAL.DISCONNECTED,
    includeError: canonical === SESSION_CANONICAL.FAILED || Boolean(errMsg),
  });

  lastEmitted.set(key, { canonical, qrKey: qk });
  return { skipped: false, canonical };
}
