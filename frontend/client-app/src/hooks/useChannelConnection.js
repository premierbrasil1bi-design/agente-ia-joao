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

function extractQrValue(payload) {
  return payload?.qr ?? payload?.qrCode ?? payload?.qrcode ?? payload?.qrAscii ?? null;
}

function pickChannelSnapshot(statusData, qrData) {
  const ch =
    statusData?.channel && typeof statusData.channel === 'object' ? statusData.channel : {};
  const qr =
    extractQrValue(qrData) ||
    extractQrValue(ch) ||
    extractQrValue(statusData) ||
    null;
  const rawStatus =
    statusData?.normalizedStatus ??
    statusData?.status ??
    ch?.status ??
    qrData?.state ??
    null;
  return { qr, rawStatus, channel: ch };
}

function resolveStatusFromChannel({ rawStatus, qr }) {
  const hasQr = qr != null && String(qr).trim() !== '';
  if (hasQr) {
    return 'PENDING';
  }
  return normalizeChannelStatus(rawStatus);
}

export function useChannelConnection() {
  const [qrCode, setQrCode] = useState('');
  const [qrFormat, setQrFormat] = useState('image');
  const [status, setStatus] = useState('UNKNOWN');
  const [loading, setLoading] = useState(false);
  const [timeout, setTimeoutState] = useState(false);
  const [error, setError] = useState(null);
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

  const applyQrFromPayload = useCallback((qrValue, payload) => {
    if (qrValue == null || qrValue === '') return false;
    const s = typeof qrValue === 'string' ? qrValue : String(qrValue);
    if (!s.trim()) return false;
    if (payload?.format === 'ascii' && (payload?.qrAscii ?? payload?.qr)) {
      setQrCode(String(payload.qrAscii ?? payload.qr));
      setQrFormat('ascii');
    } else if (s.length <= 100 && !s.startsWith('data:image') && !/^https?:\/\//i.test(s)) {
      setQrCode(s);
      setQrFormat('ascii');
    } else {
      const formatted = toQrDataUrl(s);
      if (formatted) {
        setQrCode(formatted);
        setQrFormat('image');
      } else {
        setQrCode(s);
        setQrFormat('ascii');
      }
    }
    setError(null);
    setLoading(false);
    setStatus('PENDING');
    return true;
  }, []);

  const applyBackendSnapshot = useCallback(
    (statusData, qrData) => {
      const { qr, rawStatus } = pickChannelSnapshot(statusData, qrData);
      const resolved = resolveStatusFromChannel({ rawStatus, qr });

      if (qr != null && String(qr).trim() !== '') {
        applyQrFromPayload(typeof qr === 'string' ? qr : String(qr), qrData ?? statusData);
        return { done: true, resolved: 'PENDING' };
      }

      setQrCode('');
      setQrFormat('image');

      if (resolved === 'CONNECTED') {
        setError(null);
        setLoading(false);
        setStatus('CONNECTED');
        stopConnection();
        return { done: true, resolved: 'CONNECTED' };
      }

      if (resolved === 'PENDING') {
        setError(null);
        setLoading(true);
        setStatus('PENDING');
        return { done: false, resolved: 'PENDING' };
      }

      if (resolved === 'DISCONNECTED') {
        setLoading(false);
        setError(null);
        setStatus('DISCONNECTED');
        return { done: false, resolved: 'DISCONNECTED' };
      }

      setLoading(false);
      setError(null);
      setStatus(resolved);
      return { done: false, resolved };
    },
    [applyQrFromPayload, stopConnection],
  );

  const pollOnce = useCallback(async () => {
    const channelId = channelIdRef.current;
    if (!channelId || !runningRef.current || realtimeActiveRef.current) return;

    try {
      const [statusData, qrData] = await Promise.all([
        channelsService.getStatus(channelId),
        channelsService.getQrCode(channelId),
      ]);

      applyBackendSnapshot(statusData, qrData);
    } catch (err) {
      console.warn('[CHANNEL HOOK] polling', err?.message || err);
    }
  }, [applyBackendSnapshot]);

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
        const qr = extractQrValue(evt);
        if (qr != null && String(qr).trim() !== '') {
          applyQrFromPayload(typeof qr === 'string' ? qr : String(qr), evt);
          clearTimers();
          return;
        }
        const st = String(evt.state ?? evt.status ?? '').toUpperCase();
        if (st === 'OFFLINE' || st === 'DISCONNECTED') {
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
    [applyQrFromPayload, clearTimers, startPolling, stopConnection],
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
