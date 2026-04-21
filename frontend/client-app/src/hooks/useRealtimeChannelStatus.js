import { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { agentApi } from '../services/agentApi.js';
import { normalizeChannelStatus } from '../utils/channelCore.js';

function canonicalToUiStatus(canonical) {
  const c = String(canonical || '').toUpperCase();
  if (c === 'CONNECTED') return 'CONNECTED';
  if (c === 'DISCONNECTED') return 'DISCONNECTED';
  if (c === 'FAILED') return 'ERROR';
  if (c === 'QR_READY' || c === 'CONNECTING') return 'PENDING';
  return 'UNKNOWN';
}

function mapPayloadToConnectionFields(evt) {
  const canonical = String(evt?.status || '').toUpperCase();
  const ui = canonicalToUiStatus(canonical);
  const connection_status =
    canonical === 'CONNECTED'
      ? 'connected'
      : canonical === 'DISCONNECTED'
        ? 'disconnected'
        : canonical === 'FAILED'
          ? 'error'
          : 'connecting';
  return { ui, connection_status, canonical };
}

/**
 * Status em tempo real de um canal WhatsApp via Socket.IO (fallback: estado inicial apenas).
 * @param {string|null|undefined} channelId
 * @param {{ onEvent?: (evt: object) => void }} [options]
 */
export function useRealtimeChannelStatus(channelId, options = {}) {
  const { onEvent } = options;
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const [snapshot, setSnapshot] = useState({
    status: 'UNKNOWN',
    qr: null,
    error: null,
    lastUpdate: null,
  });
  const socketRef = useRef(null);

  const applyPayload = useCallback((evt) => {
    if (!evt || String(evt.channelId) !== String(channelId)) return;
    const { ui, connection_status, canonical } = mapPayloadToConnectionFields(evt);
    const qr = evt.qr ?? evt.qrCode ?? null;
    const err = evt.error ?? null;
    setSnapshot({
      status: ui,
      qr,
      error: err,
      lastUpdate: evt.timestamp || new Date().toISOString(),
    });
    onEventRef.current?.({
      ...evt,
      normalizedUiStatus: ui,
      connection_status,
      canonical,
    });
  }, [channelId]);

  useEffect(() => {
    if (!channelId) return undefined;

    const token = agentApi.getToken();
    const tenantId = String(agentApi.getAgent()?.tenantId || agentApi.getAgent()?.tenant_id || '').trim();
    if (!token || !tenantId) {
      return undefined;
    }

    const baseUrl = import.meta.env.VITE_API_URL || window.location.origin;
    const socket = io(baseUrl, {
      transports: ['websocket'],
      withCredentials: true,
      auth: { token, tenantId },
      reconnection: true,
    });
    socketRef.current = socket;

    const onConnect = () => {
      socket.emit('channels:subscribe', { tenantId }, () => {});
      socket.emit('channel:subscribe', { tenantId, channelId }, () => {});
    };

    const handlers = [
      ['channel:status', applyPayload],
      ['channel:qr', applyPayload],
      ['channel:connected', applyPayload],
      ['channel:disconnected', applyPayload],
      ['channel:error', applyPayload],
    ];

    socket.on('connect', onConnect);
    for (const [ev, fn] of handlers) {
      socket.on(ev, fn);
    }
    if (socket.connected) onConnect();

    return () => {
      socket.off('connect', onConnect);
      for (const [ev, fn] of handlers) {
        socket.off(ev, fn);
      }
      socket.disconnect();
      socketRef.current = null;
    };
  }, [channelId, applyPayload]);

  return {
    ...snapshot,
    /** Alias alinhado ao channelCore */
    normalizedStatus: normalizeChannelStatus(snapshot.status),
  };
}

/**
 * Mescla evento Socket canônico na linha do canal (lista), alinhado a `enrichChannelForApi` / `evolutionUiStatus`.
 * @param {object} ch
 * @param {object} evt
 */
export function mergeSocketSessionIntoChannelRow(ch, evt) {
  if (!evt || !ch || String(evt.channelId) !== String(ch.id)) return ch;
  const c = String(evt.status || '').toUpperCase();
  let connection_status = ch.connection_status;
  if (c === 'CONNECTED') connection_status = 'connected';
  else if (c === 'DISCONNECTED') connection_status = 'disconnected';
  else if (c === 'FAILED') connection_status = 'error';
  else connection_status = 'connecting';

  const base = { ...ch, connection_status };
  const ext = base.external_id != null ? String(base.external_id).trim() : '';
  const cs = String(connection_status || '').toLowerCase();
  let status = base.status;
  if (cs === 'connecting') status = 'connecting';
  else if (cs === 'connected') status = 'connected';
  else if (cs === 'error') status = 'error';
  else if (cs === 'disconnected') {
    status = ext ? 'created' : 'disconnected';
  }

  const out = { ...base, status };
  if (evt.error != null && String(evt.error).trim() !== '') {
    out.last_error = String(evt.error);
  }
  return out;
}

/**
 * Socket autenticado: sala do tenant recebe todos os `channel:*` emitidos pelo backend.
 * @param {(evt: object) => void} onChannelSessionEvent
 * @param {{ enabled?: boolean }} [opts]
 */
export function useTenantChannelsSocket(onChannelSessionEvent, opts = {}) {
  const { enabled = true } = opts;
  const cbRef = useRef(onChannelSessionEvent);
  cbRef.current = onChannelSessionEvent;

  useEffect(() => {
    if (!enabled) return undefined;

    const token = agentApi.getToken();
    const tenantId = String(agentApi.getAgent()?.tenantId || agentApi.getAgent()?.tenant_id || '').trim();
    if (!token || !tenantId) return undefined;

    const baseUrl = import.meta.env.VITE_API_URL || window.location.origin;
    const socket = io(baseUrl, {
      transports: ['websocket'],
      withCredentials: true,
      auth: { token, tenantId },
      reconnection: true,
    });

    const onConnect = () => {
      socket.emit('channels:subscribe', { tenantId }, () => {});
    };

    const forward = (evt) => {
      cbRef.current?.(evt);
    };

    const events = [
      'channel:status',
      'channel:qr',
      'channel:connected',
      'channel:disconnected',
      'channel:error',
    ];

    socket.on('connect', onConnect);
    for (const ev of events) {
      socket.on(ev, forward);
    }
    if (socket.connected) onConnect();

    return () => {
      socket.off('connect', onConnect);
      for (const ev of events) {
        socket.off(ev, forward);
      }
      socket.disconnect();
    };
  }, [enabled]);
}
