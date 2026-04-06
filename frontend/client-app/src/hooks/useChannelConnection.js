import { useCallback, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { channelsService } from '../services/channels.service.js';
import { agentApi } from '../services/agentApi.js';
import { normalizeChannelStatus, mapChannelToConnectionState } from '../utils/channelCore.js';

function toQrDataUrl(raw) {
  if (!raw || typeof raw !== 'string') return '';
  if (raw.startsWith('data:') || /^https?:\/\//i.test(raw)) return raw;
  return `data:image/png;base64,${raw.replace(/^data:image\/\w+;base64,/, '')}`;
}

/** Estados explícitos do fluxo WAHA (backend / socket). */
const WAHA_QR_STATES = new Set([
  'QR_AVAILABLE',
  'PENDING',
  'OFFLINE',
  'UNSTABLE',
  'UNAVAILABLE',
  'CANCELLED',
  'CONNECTED',
]);

export function useChannelConnection() {
  const [qrCode, setQrCode] = useState('');
  /** 'image' = data URL / URL para <img>; 'ascii' = texto para <pre> */
  const [qrFormat, setQrFormat] = useState('image');
  const [status, setStatus] = useState('UNKNOWN');
  const [loading, setLoading] = useState(false);
  const [timeout, setTimeoutState] = useState(false);
  const [error, setError] = useState(null);
  /** Mensagem opcional de etapa (ex.: provisionamento SaaS) — consumida pela UI de Canais */
  const [connectStepMessage, setConnectStepMessage] = useState('');

  const channelIdRef = useRef(null);
  const socketRef = useRef(null);
  const pollingRef = useRef(null);
  const timeoutRef = useRef(null);
  const realtimeActiveRef = useRef(false);
  const runningRef = useRef(false);

  const clearTimers = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  /** Para OFFLINE / UNSTABLE / UNAVAILABLE / CANCELLED: interrompe polling e timeout global sem derrubar o socket. */
  const stopPollingAndChannelTimeout = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const stopConnection = useCallback(() => {
    runningRef.current = false;
    clearTimers();
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    realtimeActiveRef.current = false;
    channelIdRef.current = null;
    setLoading(false);
    setTimeoutState(false);
    setConnectStepMessage('');
  }, [clearTimers]);

  const applyExplicitQrState = useCallback(
    (rawState, payload) => {
      const state = String(rawState || '').toUpperCase();
      if (!WAHA_QR_STATES.has(state)) return false;

      console.log(`[CHANNEL] state: ${state}`);

      switch (state) {
        case 'QR_AVAILABLE': {
          setError(null);
          setLoading(false);
          const fmt = payload?.format;
          if (fmt === 'ascii' && (payload?.qrAscii ?? payload?.qr)) {
            setQrCode(String(payload.qrAscii ?? payload.qr));
            setQrFormat('ascii');
          } else {
            const raw =
              payload?.qrCode || payload?.qr || payload?.qrcode || '';
            const formatted = toQrDataUrl(typeof raw === 'string' ? raw : '');
            if (formatted) {
              setQrCode(formatted);
              setQrFormat('image');
            }
          }
          setStatus('PENDING');
          return true;
        }
        case 'PENDING':
          setError(null);
          setLoading(true);
          setStatus('PENDING');
          return true;
        case 'OFFLINE':
          stopPollingAndChannelTimeout();
          runningRef.current = false;
          setLoading(false);
          setError('Servidor desconectado');
          setStatus('DISCONNECTED');
          return true;
        case 'UNSTABLE':
          stopPollingAndChannelTimeout();
          runningRef.current = false;
          setLoading(false);
          setError('Instabilidade no WhatsApp, tente novamente');
          setStatus('DISCONNECTED');
          return true;
        case 'UNAVAILABLE':
          stopPollingAndChannelTimeout();
          runningRef.current = false;
          setLoading(false);
          setError('Serviço temporariamente indisponível. Tente novamente em instantes.');
          setStatus('DISCONNECTED');
          return true;
        case 'CANCELLED':
          stopPollingAndChannelTimeout();
          runningRef.current = false;
          setLoading(false);
          setError(null);
          setStatus('UNKNOWN');
          return true;
        case 'CONNECTED':
          setError(null);
          setLoading(false);
          setStatus('CONNECTED');
          stopConnection();
          return true;
        default:
          return false;
      }
    },
    [stopConnection, stopPollingAndChannelTimeout],
  );

  const pollOnce = useCallback(async () => {
    const channelId = channelIdRef.current;
    if (!channelId || !runningRef.current || realtimeActiveRef.current) return;

    try {
      const statusData = await channelsService.getStatus(channelId);
      const normalized = normalizeChannelStatus(statusData?.status || statusData?.normalizedStatus);
      setStatus(normalized);

      if (normalized === 'CONNECTED') {
        stopConnection();
        return;
      }

      const qrData = await channelsService.getQrCode(channelId);
      const explicit = qrData?.state != null ? String(qrData.state).toUpperCase() : '';
      if (explicit && applyExplicitQrState(explicit, qrData)) {
        return;
      }

      const raw = qrData?.qrCode || qrData?.qr || qrData?.qrcode || '';
      const formatted = toQrDataUrl(typeof raw === 'string' ? raw : raw?.base64 ?? raw?.code ?? '');
      if (formatted) {
        setQrCode(formatted);
        setQrFormat('image');
      }
    } catch (err) {
      console.warn('[CHANNEL HOOK] fallback polling active', err?.message || err);
    }
  }, [applyExplicitQrState, stopConnection]);

  const startPolling = useCallback(() => {
    clearTimers();
    pollingRef.current = setInterval(pollOnce, 2000);
    timeoutRef.current = setTimeout(() => {
      stopConnection();
      setStatus('UNKNOWN');
      setTimeoutState(true);
    }, 60000);
  }, [clearTimers, pollOnce, stopConnection]);

  const startSocket = useCallback(
    (channelId) => {
      const token = agentApi.getToken();
      const tenantId = String(agentApi.getAgent()?.tenantId || agentApi.getAgent()?.tenant_id || '').trim();
      if (!token || !tenantId) {
        console.warn('[CHANNEL HOOK] fallback polling active');
        startPolling();
        return;
      }

      const baseUrl = import.meta.env.VITE_API_URL || window.location.origin;
      const socket = io(baseUrl, {
        transports: ['websocket'],
        withCredentials: true,
        auth: { token, tenantId },
        reconnection: true,
      });
      socketRef.current = socket;

      socket.on('connect', () => {
        console.info('[CHANNEL HOOK] socket connected');
        socket.emit('channels:subscribe', { tenantId }, () => {});
        socket.emit('channel:subscribe', { tenantId, channelId }, () => {});
      });

      socket.on('channel:qr', (evt) => {
        if (!evt || String(evt.channelId) !== String(channelIdRef.current)) return;
        realtimeActiveRef.current = true;
        const explicit = evt.state != null ? String(evt.state).toUpperCase() : '';
        if (explicit && applyExplicitQrState(explicit, evt)) {
          clearTimers();
          return;
        }
        clearTimers();
        if (evt.format === 'ascii' && evt.qrAscii) {
          setQrCode(String(evt.qrAscii));
          setQrFormat('ascii');
        } else {
          const formatted = toQrDataUrl(evt.qrCode || '');
          if (formatted) {
            setQrCode(formatted);
            setQrFormat('image');
          }
        }
        setStatus(normalizeChannelStatus(evt.status || 'PENDING'));
        setLoading(false);
        setError(null);
      });

      socket.on('channel:status', (evt) => {
        if (!evt || String(evt.channelId) !== String(channelIdRef.current)) return;
        realtimeActiveRef.current = true;
        clearTimers();
        const normalized = normalizeChannelStatus(evt.status);
        setStatus(normalized);
        setLoading(false);
        setError(null);
        if (normalized === 'CONNECTED') stopConnection();
      });

      socket.on('channel:connected', (evt) => {
        if (!evt || String(evt.channelId) !== String(channelIdRef.current)) return;
        realtimeActiveRef.current = true;
        setStatus('CONNECTED');
        setLoading(false);
        setError(null);
        stopConnection();
      });

      socket.on('disconnect', () => {
        realtimeActiveRef.current = false;
        if (runningRef.current) {
          console.warn('[CHANNEL HOOK] fallback polling active');
          startPolling();
        }
      });

      socket.on('connect_error', () => {
        realtimeActiveRef.current = false;
        if (runningRef.current) {
          console.warn('[CHANNEL HOOK] fallback polling active');
          startPolling();
        }
      });
    },
    [applyExplicitQrState, clearTimers, startPolling, stopConnection],
  );

  const startConnection = useCallback(
    async (channelId) => {
      if (!channelId) return;
      stopConnection();
      runningRef.current = true;
      channelIdRef.current = channelId;
      setLoading(true);
      setStatus('PENDING');
      setQrCode('');
      setQrFormat('image');
      setTimeoutState(false);
      setError(null);

      try {
        await channelsService.connectChannel(channelId);
        startSocket(channelId);
        await pollOnce();
        if (!realtimeActiveRef.current && runningRef.current) {
          startPolling();
        }
      } catch (err) {
        setLoading(false);
        setError(err?.message || 'Erro ao conectar');
        console.warn('[CHANNEL HOOK] fallback polling active', err?.message || err);
        startPolling();
        throw err;
      }
    },
    [pollOnce, startPolling, startSocket, stopConnection],
  );

  const connectionState = mapChannelToConnectionState({
    status,
    loading,
    timeout,
    error,
  });

  return {
    qrCode,
    qrFormat,
    connectionState,
    error,
    startConnection,
    stopConnection,
    connectStepMessage,
    setConnectStepMessage,
  };
}
