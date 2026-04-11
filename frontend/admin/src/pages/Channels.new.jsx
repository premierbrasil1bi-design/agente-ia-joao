import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAgentAuth } from '../context/AgentAuthContext';
import { createChannelsApi } from '../api/channels';
import { createAgentsApi } from '../api/agents';
import { agentApi } from '../services/agentApi.js';
import { io } from 'socket.io-client';
import {
  connectChannel as connectChannelApi,
  getQRCode as getQRCodeApi,
  getStatus as getStatusApi,
} from '../api/channels.ts';
import { mapChannelToConnectionState, ConnectionStateBanner } from '@omnia/channel-core';
import { useTenantLimitsContext } from '../context/TenantLimitsContext.jsx';
import { TenantPlanBadge } from '../components/tenant/TenantPlanBadge.jsx';
import { UpgradePlanModal } from '../components/tenant/UpgradePlanModal.jsx';
import { isTenantPlanLimitError, tenantPlanLimitReasonFromError } from '../utils/mapTenantLimitReason.js';

const CHANNEL_TYPES = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'webchat', label: 'Webchat' },
  { value: 'api', label: 'API' },
];

const PROVIDERS = [
  { value: 'waha', label: 'WAHA' },
  { value: 'evolution', label: 'Evolution' },
  { value: 'zapi', label: 'Z-API' },
  { value: 'official', label: 'WhatsApp Oficial' },
];

const styles = {
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 },
  title: { margin: 0, color: 'var(--text)', fontSize: '1.7rem', fontWeight: 700 },
  subtitle: { margin: 0, color: 'var(--text-muted)', fontSize: 14 },
  sectionTitle: { margin: '1rem 0 0.6rem', color: 'var(--text)' },
  primaryBtn: { border: '1px solid var(--accent)', background: 'var(--accent)', color: '#fff', borderRadius: 8, padding: '9px 14px', cursor: 'pointer', fontWeight: 600 },
  btn: { border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', borderRadius: 8, padding: '8px 12px', cursor: 'pointer' },
  btnDanger: { border: '1px solid #c0392b', color: '#c0392b', background: 'transparent', borderRadius: 8, padding: '8px 12px', cursor: 'pointer' },
  summaryGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 10 },
  summaryCard: { border: '1px solid var(--border)', background: 'var(--surface)', borderRadius: 10, padding: 14, boxShadow: '0 2px 10px rgba(0,0,0,0.08)' },
  summaryLabel: { color: 'var(--text-muted)', fontSize: 13 },
  summaryValue: { fontSize: 24, fontWeight: 700 },
  cardsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 },
  card: { border: '1px solid var(--border)', background: 'var(--surface)', borderRadius: 12, padding: 14, boxShadow: '0 3px 12px rgba(0,0,0,0.08)' },
  cardHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  cardTitle: { margin: 0, color: 'var(--text)' },
  cardInfo: { display: 'grid', gap: 4, marginTop: 8, color: 'var(--text-muted)', fontSize: 13 },
  actions: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 },
  badge: { borderRadius: 999, padding: '4px 10px', fontSize: 12, fontWeight: 600, border: '1px solid transparent' },
  empty: { border: '1px dashed var(--border)', borderRadius: 12, background: 'var(--surface)', padding: 28, textAlign: 'center', color: 'var(--text-muted)' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 14 },
  modal: { width: 'min(680px, 95vw)', maxHeight: '90vh', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)', padding: 18 },
  modalTitle: { margin: '0 0 10px', color: 'var(--text)' },
  field: { marginBottom: 12 },
  label: { display: 'block', marginBottom: 4, color: 'var(--text-muted)', fontSize: 13 },
  input: { width: '100%', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 10px', background: 'var(--bg)', color: 'var(--text)' },
  formActions: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 },
  error: { color: '#c0392b', fontSize: 13 },
};

function mapStatus(raw) {
  const s = normalizeStatus(raw);
  if (s === 'CONNECTED') return 'online';
  if (s === 'PENDING') return 'instavel';
  return 'offline';
}

function normalizeStatus(status) {
  if (!status) return 'UNKNOWN';
  const s = String(status).toLowerCase();
  if (['connected', 'online', 'open'].includes(s)) return 'CONNECTED';
  if (['connecting', 'pending', 'qr', 'created', 'awaiting_connection'].includes(s)) return 'PENDING';
  if (['disconnected', 'closed', 'close', 'inactive', 'offline', 'error'].includes(s)) return 'DISCONNECTED';
  return 'UNKNOWN';
}

function statusMeta(status) {
  if (status === 'online') return { emoji: '🟢', label: 'Online', color: '#1f9d55', bg: 'rgba(31,157,85,0.13)' };
  if (status === 'instavel') return { emoji: '🟡', label: 'Instável', color: '#b8860b', bg: 'rgba(184,134,11,0.16)' };
  return { emoji: '🔴', label: 'Offline', color: '#c0392b', bg: 'rgba(192,57,43,0.12)' };
}

function toCard(ch) {
  return {
    id: ch.id,
    nome: ch.name || ch.instance || 'Canal sem nome',
    tipo: String(ch.type || 'api').toLowerCase(),
    api: String(ch.provider || 'waha').toLowerCase(),
    status: mapStatus(ch.connection_status || ch.status),
    instancia: ch.instance || ch.external_id || '-',
    lastError: ch.last_error || '',
    lastSeen: ch.updated_at || ch.connected_at || null,
    raw: ch,
  };
}

function makeEmptyForm() {
  return {
    name: '',
    type: 'whatsapp',
    provider: 'waha',
    agent_id: '',
    active: true,
    evolutionInstanceName: '',
    zapiInstanceId: '',
    zapiToken: '',
  };
}

function buildProviderConfig(form) {
  const p = String(form.provider || '').toLowerCase();
  if (p === 'waha') return { session: 'default' };
  if (p === 'evolution') return { instanceName: String(form.evolutionInstanceName || '').trim() };
  if (p === 'zapi' || p === 'official') {
    return {
      instanceId: String(form.zapiInstanceId || '').trim(),
      token: String(form.zapiToken || '').trim(),
    };
  }
  return {};
}

function extractTenantId(agent) {
  if (!agent || typeof agent !== 'object') return '';
  return String(agent.tenantId || agent.tenant_id || '').trim();
}

function formatApiError(err) {
  const base = err?.message || 'Erro inesperado.';
  const ctx = err?.context;
  if (!ctx || typeof ctx !== 'object') return base;
  const parts = [];
  if (ctx.code != null) parts.push(`code=${ctx.code}`);
  if (ctx.timeout) parts.push('timeout');
  if (ctx.auth) parts.push('auth');
  return parts.length ? `${base} (${parts.join(', ')})` : base;
}

export function Channels() {
  const { getToken, logout } = useAgentAuth();
  const navigate = useNavigate();
  const channelsApi = useMemo(() => createChannelsApi(getToken, () => { logout(); navigate('/login', { replace: true }); }), [getToken, logout, navigate]);
  const agentsApi = useMemo(() => createAgentsApi(getToken, () => { logout(); navigate('/login', { replace: true }); }), [getToken, logout, navigate]);
  const { plan, limits, usage, features, refresh: refreshTenantLimits, loading: limitsLoading } =
    useTenantLimitsContext();

  const [planLimitModal, setPlanLimitModal] = useState({ open: false, reason: null });

  const atChannelLimit =
    limits?.maxChannels != null &&
    Number(limits.maxChannels) > 0 &&
    Number(usage?.channels ?? 0) >= Number(limits.maxChannels);
  const canCreateChannels =
    features?.can_create_channels != null
      ? Boolean(features.can_create_channels)
      : !atChannelLimit;
  const atMessageLimit =
    limits?.maxMessages != null &&
    Number(limits.maxMessages) > 0 &&
    Number(usage?.messages ?? 0) >= Number(limits.maxMessages);

  const visibleProviders = useMemo(() => {
    const allow = features?.allowed_providers;
    if (Array.isArray(allow) && allow.length > 0) {
      return PROVIDERS.filter((p) => allow.includes(p.value));
    }
    return PROVIDERS;
  }, [features?.allowed_providers]);

  const openPlanLimit = (reason) => {
    setPlanLimitModal({ open: true, reason: reason ?? null });
  };

  const tryPlanLimit = (err) => {
    if (!isTenantPlanLimitError(err)) return false;
    openPlanLimit(tenantPlanLimitReasonFromError(err));
    refreshTenantLimits();
    return true;
  };

  useEffect(() => {
    setCreateForm((s) => {
      if (visibleProviders.some((p) => p.value === s.provider)) return s;
      const next = visibleProviders[0]?.value || 'waha';
      return { ...s, provider: next };
    });
  }, [visibleProviders]);

  const [cards, setCards] = useState([]);
  const [agents, setAgents] = useState([]);
  const [evolutionInstances, setEvolutionInstances] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(makeEmptyForm());
  const [createError, setCreateError] = useState('');
  const [saving, setSaving] = useState(false);
  const [qrModal, setQrModal] = useState({ open: false, channelId: null, qr: '' });
  const [switchTarget, setSwitchTarget] = useState(null);
  const [detail, setDetail] = useState(null);
  const [connectingMap, setConnectingMap] = useState({});
  const [connectionTimeout, setConnectionTimeout] = useState(false);
  const [connectionError, setConnectionError] = useState(null);
  const pollingRef = useRef(null);
  const timeoutRef = useRef(null);
  const modalSocketRef = useRef(null);
  const realtimeActiveRef = useRef(false);

  const clearPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setConnectionTimeout(false);
  }, []);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const [channels, agentsRes, evo] = await Promise.all([
        channelsApi.getChannels(),
        agentsApi.getAgents(),
        channelsApi.getEvolutionInstances().catch(() => []),
      ]);
      setCards((Array.isArray(channels) ? channels : []).map(toCard));
      setAgents(Array.isArray(agentsRes) ? agentsRes : []);
      setEvolutionInstances(Array.isArray(evo) ? evo : []);
    } catch (e) {
      setError(e.message || 'Erro ao carregar canais.');
    } finally {
      setLoading(false);
    }
  }, [channelsApi, agentsApi]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(''), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const baseUrl = import.meta.env.VITE_API_URL || window.location.origin;
    const token = agentApi.getToken();
    const tenantId = extractTenantId(agentApi.getAgent());
    if (!token || !tenantId) return undefined;

    const socket = io(baseUrl, {
      transports: ['websocket'],
      withCredentials: true,
      auth: { token, tenantId },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      timeout: 20000,
    });

    const subscribe = () => {
      socket.emit('channels:subscribe', { tenantId }, () => {});
    };

    socket.on('connect', subscribe);
    socket.on('reconnect', subscribe);
    socket.on('connect_error', () => {
      setToast('Tempo real indisponível. Reconectando...');
    });

    socket.on('channels:updated', (evt) => {
      if (!evt?.channelId) return;
      setCards((prev) =>
        prev.map((c) =>
          c.id === evt.channelId
            ? {
                ...c,
                api: evt.provider || c.api,
                status: mapStatus(evt.connection_status || c.status),
                lastError: evt.last_error || '',
                lastSeen: evt.updated_at || c.lastSeen,
              }
            : c
        )
      );
    });

    socket.on('channels:error', (evt) => {
      if (!evt?.channelId) return;
      setCards((prev) =>
        prev.map((c) =>
          c.id === evt.channelId
            ? { ...c, status: 'offline', lastError: evt.message || c.lastError, lastSeen: evt.at || c.lastSeen }
            : c
        )
      );
      setToast(evt?.message || 'Falha de conexão no canal.');
    });

    return () => {
      socket.off('connect', subscribe);
      socket.off('reconnect', subscribe);
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!qrModal.open || !qrModal.channelId) {
      clearPolling();
      return undefined;
    }

    clearPolling();

    const poll = async () => {
      if (realtimeActiveRef.current) return;
      try {
        const statusData = await getStatusApi(qrModal.channelId);
        const normalized = normalizeStatus(
          statusData.connection_status || statusData.status || statusData?.channel?.connection_status
        );
        if (normalized === 'CONNECTED') {
          setToast('Canal conectado com sucesso.');
          clearPolling();
          setQrModal({ open: false, channelId: null, qr: '' });
          refresh();
          return;
        }
        setToast('Aguardando leitura...');
        if (normalized !== 'CONNECTED') {
          const qrData = await getQRCodeApi(qrModal.channelId);
          const raw = qrData.qr || qrData.qrcode || qrData.qrCode || '';
          const formatted = typeof raw === 'string' && raw ? (raw.startsWith('data:') ? raw : `data:image/png;base64,${raw}`) : '';
          setQrModal((m) => ({ ...m, qr: formatted || m.qr }));
          if (!formatted) setToast('Gerando QR Code...');
        }
      } catch (err) {
        setConnectionError(err?.message || 'Erro ao conectar');
        console.warn('[QR POLLING]', err?.message || err);
      }
    };

    poll();
    pollingRef.current = setInterval(poll, 2000);
    timeoutRef.current = setTimeout(() => {
      clearPolling();
      setConnectionTimeout(true);
      setToast('Tempo expirado. Tente conectar novamente.');
    }, 60000);

    return () => clearPolling();
  }, [qrModal.open, qrModal.channelId, refresh, clearPolling]);

  useEffect(() => {
    if (!qrModal.open || !qrModal.channelId) {
      realtimeActiveRef.current = false;
      if (modalSocketRef.current) {
        modalSocketRef.current.disconnect();
        modalSocketRef.current = null;
      }
      return;
    }

    const baseUrl = import.meta.env.VITE_API_URL || window.location.origin;
    const token = agentApi.getToken();
    const tenantId = extractTenantId(agentApi.getAgent());
    if (!token || !tenantId) {
      console.warn('[CHANNEL SOCKET] fallback polling enabled');
      return;
    }

    const socket = io(baseUrl, {
      transports: ['websocket'],
      withCredentials: true,
      auth: { token, tenantId },
      reconnection: true,
    });
    modalSocketRef.current = socket;

    const onQr = (evt) => {
      if (!evt || String(evt.channelId) !== String(qrModal.channelId)) return;
      realtimeActiveRef.current = true;
      clearPolling();
      const raw = evt.qrCode;
      if (typeof raw === 'string' && raw) {
        const formatted = raw.startsWith('data:') ? raw : `data:image/png;base64,${raw}`;
        setQrModal((m) => ({ ...m, qr: formatted || m.qr }));
      }
      setToast('Aguardando leitura...');
    };

    const onStatus = (evt) => {
      if (!evt || String(evt.channelId) !== String(qrModal.channelId)) return;
      realtimeActiveRef.current = true;
      clearPolling();
      const normalized = normalizeStatus(evt.status);
      if (normalized === 'CONNECTED') {
        setToast('Conectado com sucesso');
        setQrModal({ open: false, channelId: null, qr: '' });
        refresh();
      } else {
        setToast('Aguardando leitura...');
      }
    };

    const onConnected = (evt) => {
      if (!evt || String(evt.channelId) !== String(qrModal.channelId)) return;
      realtimeActiveRef.current = true;
      clearPolling();
      setToast('Conectado com sucesso');
      setQrModal({ open: false, channelId: null, qr: '' });
      refresh();
    };

    socket.on('connect', () => {
      console.info('[CHANNEL SOCKET] connected');
      socket.emit('channels:subscribe', { tenantId }, () => {});
      socket.emit('channel:subscribe', { tenantId, channelId: qrModal.channelId }, () => {});
    });
    socket.on('disconnect', () => {
      realtimeActiveRef.current = false;
      console.warn('[CHANNEL SOCKET] fallback polling enabled');
    });
    socket.on('connect_error', () => {
      realtimeActiveRef.current = false;
      console.warn('[CHANNEL SOCKET] fallback polling enabled');
    });
    socket.on('channel:qr', onQr);
    socket.on('channel:status', onStatus);
    socket.on('channel:connected', onConnected);

    return () => {
      socket.off('channel:qr', onQr);
      socket.off('channel:status', onStatus);
      socket.off('channel:connected', onConnected);
      socket.disconnect();
      modalSocketRef.current = null;
      realtimeActiveRef.current = false;
    };
  }, [qrModal.open, qrModal.channelId, refresh, clearPolling]);

  const counters = useMemo(() => {
    const base = { online: 0, instavel: 0, offline: 0 };
    cards.forEach((c) => { base[c.status] += 1; });
    return base;
  }, [cards]);

  const createChannel = async (e) => {
    e.preventDefault();
    try {
      setCreateError('');
      setSaving(true);
      if (!canCreateChannels) {
        setCreateError('Limite do plano atingido.');
        return;
      }
      if (!createForm.name.trim()) throw new Error('Informe o nome do canal.');
      if (!createForm.agent_id) throw new Error('Selecione um agente.');
      const provider_config = buildProviderConfig(createForm);
      if (createForm.provider === 'evolution' && !provider_config.instanceName) throw new Error('Informe instanceName da Evolution.');
      if ((createForm.provider === 'zapi' || createForm.provider === 'official') && (!provider_config.instanceId || !provider_config.token)) {
        throw new Error('Informe instanceId e token.');
      }
      await channelsApi.createChannel({
        name: createForm.name.trim(),
        type: createForm.type,
        provider: createForm.provider,
        provider_config,
        agent_id: createForm.agent_id,
        active: createForm.active,
        ...(createForm.provider === 'evolution' ? { instance: provider_config.instanceName } : {}),
      });
      setCreateOpen(false);
      setCreateForm(makeEmptyForm());
      setToast('Canal criado com sucesso.');
      refresh();
      refreshTenantLimits();
    } catch (err) {
      if (tryPlanLimit(err)) {
        setCreateError('');
        return;
      }
      setCreateError(err.message || 'Erro ao criar canal.');
    } finally {
      setSaving(false);
    }
  };

  const connectChannel = async (card) => {
    if (card.status === 'online') {
      setToast('Conectado');
      return;
    }
    setConnectingMap((prev) => ({ ...prev, [card.id]: true }));
    setConnectionError(null);
    setConnectionTimeout(false);
    try {
      await connectChannelApi(card.id);
      const data = await getQRCodeApi(card.id).catch(() => ({}));
      const raw = data?.qr || data?.qrcode || '';
      const formatted = typeof raw === 'string' && raw ? (raw.startsWith('data:') ? raw : `data:image/png;base64,${raw}`) : '';
      setQrModal({ open: true, channelId: card.id, qr: formatted });
      setToast('Gerando QR Code...');
      refresh();
    } catch (err) {
      if (tryPlanLimit(err)) {
        setConnectionError(null);
        return;
      }
      setConnectionError(err?.message || 'Erro ao conectar');
      setToast(formatApiError(err));
    } finally {
      setConnectingMap((prev) => ({ ...prev, [card.id]: false }));
    }
  };

  const disconnectChannel = async (card) => {
    try {
      await agentApi.request(`/api/channels/${card.id}/disconnect`, { method: 'POST' });
      setToast('Canal desconectado.');
      refresh();
    } catch (err) {
      setToast(formatApiError(err));
    }
  };

  const confirmSwitchApi = async () => {
    if (!switchTarget) return;
    try {
      // Troca segura: desconectar provider anterior antes de alterar credenciais/provider.
      await agentApi.request(`/api/channels/${switchTarget.id}/disconnect`, { method: 'POST' }).catch(() => {});
      const provider = switchTarget.providerDraft || switchTarget.api;
      const provider_config = buildProviderConfig({
        provider,
        evolutionInstanceName: switchTarget.evolutionInstanceName || '',
        zapiInstanceId: switchTarget.zapiInstanceId || '',
        zapiToken: switchTarget.zapiToken || '',
      });
      await channelsApi.updateChannel(switchTarget.id, { provider, provider_config });
      setSwitchTarget(null);
      setToast('API alterada.');
      refresh();
    } catch (err) {
      setToast(formatApiError(err));
    }
  };

  const agentName = (id) => agents.find((a) => a.id === id)?.name || '—';
  const currentConnectionState = mapChannelToConnectionState({
    status: qrModal.channelId ? cards.find((c) => c.id === qrModal.channelId)?.status : null,
    loading: qrModal.channelId ? Boolean(connectingMap[qrModal.channelId]) : false,
    timeout: connectionTimeout,
    error: connectionError,
  });

  if (loading) return <div style={{ color: 'var(--text-muted)' }}>Carregando...</div>;

  return (
    <>
      <div style={styles.header}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h2 style={styles.title}>Canais</h2>
            {!limitsLoading && plan != null ? <TenantPlanBadge plan={plan} /> : null}
          </div>
          <p style={styles.subtitle}>Monitoramento e gestão de canais omnichannel</p>
        </div>
        <button
          type="button"
          style={{
            ...styles.primaryBtn,
            opacity: !canCreateChannels || limitsLoading ? 0.55 : 1,
            cursor: !canCreateChannels || limitsLoading ? 'not-allowed' : 'pointer',
          }}
          title={!canCreateChannels ? 'Seu plano atingiu o limite de canais' : ''}
          disabled={!canCreateChannels || limitsLoading}
          onClick={() => {
            if (!canCreateChannels) return;
            setCreateOpen(true);
            setCreateError('');
          }}
        >
          + Novo canal
        </button>
      </div>

      {error && <div style={styles.error}>{error}</div>}

      <h3 style={styles.sectionTitle}>Status Geral</h3>
      <div style={styles.summaryGrid}>
        <div style={styles.summaryCard}><div style={styles.summaryLabel}>Online</div><div style={{ ...styles.summaryValue, color: '#1f9d55' }}>{counters.online}</div></div>
        <div style={styles.summaryCard}><div style={styles.summaryLabel}>Instável</div><div style={{ ...styles.summaryValue, color: '#b8860b' }}>{counters.instavel}</div></div>
        <div style={styles.summaryCard}><div style={styles.summaryLabel}>Offline</div><div style={{ ...styles.summaryValue, color: '#c0392b' }}>{counters.offline}</div></div>
      </div>

      <h3 style={styles.sectionTitle}>Lista de Canais</h3>
      {cards.length === 0 ? (
        <div style={styles.empty}>
          <p>Nenhum canal conectado ainda</p>
          <button
            type="button"
            style={{ ...styles.primaryBtn, opacity: !canCreateChannels || limitsLoading ? 0.55 : 1 }}
            title={!canCreateChannels ? 'Seu plano atingiu o limite de canais' : ''}
            disabled={!canCreateChannels || limitsLoading}
            onClick={() => canCreateChannels && setCreateOpen(true)}
          >
            + Criar canal
          </button>
        </div>
      ) : (
        <div style={styles.cardsGrid}>
          {cards.map((card) => {
            const meta = statusMeta(card.status);
            return (
              <div key={card.id} style={styles.card}>
                <div style={styles.cardHead}>
                  <h4 style={styles.cardTitle}>{card.nome}</h4>
                  <span style={{ ...styles.badge, color: meta.color, background: meta.bg }}>{meta.emoji} {meta.label}</span>
                </div>
                <div style={styles.cardInfo}>
                  <div><b>Tipo:</b> {card.tipo}</div>
                  <div><b>API atual:</b> {card.api.toUpperCase()}</div>
                  <div><b>Instância:</b> {card.instancia}</div>
                  <div><b>Agente:</b> {agentName(card.raw.agent_id)}</div>
                  <div><b>Última atividade:</b> {card.lastSeen ? new Date(card.lastSeen).toLocaleString() : '—'}</div>
                  {card.lastError ? <div style={{ color: '#c0392b' }}><b>Último erro:</b> {card.lastError}</div> : null}
                </div>
                <div style={styles.actions}>
                  {card.status === 'offline' && (
                    <button
                      type="button"
                      style={{ ...styles.primaryBtn, opacity: atMessageLimit || limitsLoading ? 0.55 : 1 }}
                      title={atMessageLimit ? 'Cota de mensagens do período esgotada' : ''}
                      onClick={() => connectChannel(card)}
                      disabled={Boolean(connectingMap[card.id]) || atMessageLimit || limitsLoading}
                    >
                      {connectingMap[card.id] ? 'Conectando...' : 'Conectar WhatsApp'}
                    </button>
                  )}
                  {card.status === 'instavel' && (
                    <button
                      type="button"
                      style={{ ...styles.primaryBtn, opacity: atMessageLimit || limitsLoading ? 0.55 : 1 }}
                      title={atMessageLimit ? 'Cota de mensagens do período esgotada' : ''}
                      onClick={() => connectChannel(card)}
                      disabled={Boolean(connectingMap[card.id]) || atMessageLimit || limitsLoading}
                    >
                      {connectingMap[card.id] ? 'Conectando...' : 'Reconectar WhatsApp'}
                    </button>
                  )}
                  {card.status === 'online' && <button style={styles.btn} disabled>Conectado</button>}
                  {card.status === 'online' && <button style={styles.primaryBtn} onClick={() => setDetail(card)}>Gerenciar</button>}
                  <button
                    style={styles.btn}
                    onClick={() => {
                      const cur = String(card.api || '').toLowerCase();
                      const draft = visibleProviders.some((p) => p.value === cur)
                        ? cur
                        : (visibleProviders[0]?.value || cur);
                      setSwitchTarget({
                        ...card,
                        providerDraft: draft,
                        evolutionInstanceName: card.raw?.provider_config?.instanceName || '',
                        zapiInstanceId: card.raw?.provider_config?.instanceId || '',
                        zapiToken: card.raw?.provider_config?.token || '',
                      });
                    }}
                  >
                    Trocar API
                  </button>
                  {card.status === 'online' && <button style={styles.btnDanger} onClick={() => disconnectChannel(card)}>Desconectar</button>}
                  <button style={styles.btn} onClick={() => setDetail(card)}>Ver detalhes</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {createOpen && (
        <div style={styles.overlay} onClick={() => setCreateOpen(false)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>Novo canal</h3>
            <form onSubmit={createChannel}>
              <div style={styles.field}><label style={styles.label}>Nome do canal</label><input style={styles.input} value={createForm.name} onChange={(e) => setCreateForm((s) => ({ ...s, name: e.target.value }))} /></div>
              <div style={styles.field}><label style={styles.label}>Tipo de canal</label><select style={styles.input} value={createForm.type} onChange={(e) => setCreateForm((s) => ({ ...s, type: e.target.value }))}>{CHANNEL_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></div>
              <div style={styles.field}><label style={styles.label}>API</label><select style={styles.input} value={createForm.provider} onChange={(e) => setCreateForm((s) => ({ ...s, provider: e.target.value }))}>{visibleProviders.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select></div>
              {createForm.provider === 'waha' && <div style={styles.field}><label style={styles.label}>Sessão WAHA</label><input style={styles.input} value="default" disabled /></div>}
              {createForm.provider === 'evolution' && (
                <div style={styles.field}>
                  <label style={styles.label}>Instance Name (Evolution)</label>
                  <select style={styles.input} value={createForm.evolutionInstanceName} onChange={(e) => setCreateForm((s) => ({ ...s, evolutionInstanceName: e.target.value }))}>
                    <option value="">Selecionar instância existente</option>
                    {evolutionInstances.map((x, i) => {
                      const v = typeof x === 'string' ? x : (x?.instanceName || x?.name || '');
                      return <option key={`${v}-${i}`} value={v}>{v}</option>;
                    })}
                  </select>
                  <input style={{ ...styles.input, marginTop: 8 }} value={createForm.evolutionInstanceName} onChange={(e) => setCreateForm((s) => ({ ...s, evolutionInstanceName: e.target.value }))} placeholder="...ou criar nova instância" />
                </div>
              )}
              {(createForm.provider === 'zapi' || createForm.provider === 'official') && (
                <>
                  <div style={styles.field}><label style={styles.label}>Instance ID</label><input style={styles.input} value={createForm.zapiInstanceId} onChange={(e) => setCreateForm((s) => ({ ...s, zapiInstanceId: e.target.value }))} /></div>
                  <div style={styles.field}><label style={styles.label}>Token</label><input style={styles.input} value={createForm.zapiToken} onChange={(e) => setCreateForm((s) => ({ ...s, zapiToken: e.target.value }))} /></div>
                </>
              )}
              <div style={styles.field}><label style={styles.label}>Agente</label><select style={styles.input} value={createForm.agent_id} onChange={(e) => setCreateForm((s) => ({ ...s, agent_id: e.target.value }))}><option value="">Selecionar</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
              {createError && <div style={styles.error}>{createError}</div>}
              <div style={styles.formActions}>
                <button type="button" style={styles.btn} onClick={() => setCreateOpen(false)}>Cancelar</button>
                <button type="submit" style={styles.primaryBtn} disabled={saving || !canCreateChannels}>{saving ? 'Criando...' : 'Criar canal'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {switchTarget && (
        <div style={styles.overlay} onClick={() => setSwitchTarget(null)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>Trocar API</h3>
            <div style={styles.field}><label style={styles.label}>API</label><select style={styles.input} value={switchTarget.providerDraft} onChange={(e) => setSwitchTarget((s) => ({ ...s, providerDraft: e.target.value }))}>{visibleProviders.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select></div>
            {(switchTarget.providerDraft === 'evolution') && <div style={styles.field}><label style={styles.label}>Instance Name</label><input style={styles.input} value={switchTarget.evolutionInstanceName} onChange={(e) => setSwitchTarget((s) => ({ ...s, evolutionInstanceName: e.target.value }))} /></div>}
            {(switchTarget.providerDraft === 'zapi' || switchTarget.providerDraft === 'official') && (
              <>
                <div style={styles.field}><label style={styles.label}>Instance ID</label><input style={styles.input} value={switchTarget.zapiInstanceId} onChange={(e) => setSwitchTarget((s) => ({ ...s, zapiInstanceId: e.target.value }))} /></div>
                <div style={styles.field}><label style={styles.label}>Token</label><input style={styles.input} value={switchTarget.zapiToken} onChange={(e) => setSwitchTarget((s) => ({ ...s, zapiToken: e.target.value }))} /></div>
              </>
            )}
            <div style={styles.formActions}>
              <button style={styles.btn} onClick={() => setSwitchTarget(null)}>Cancelar</button>
              <button style={styles.primaryBtn} onClick={confirmSwitchApi}>Confirmar troca</button>
            </div>
          </div>
        </div>
      )}

      {detail && (
        <div style={styles.overlay} onClick={() => setDetail(null)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>Detalhes do canal</h3>
            <pre style={{ whiteSpace: 'pre-wrap', color: 'var(--text)', fontSize: 13 }}>{JSON.stringify(detail.raw, null, 2)}</pre>
            <div style={styles.formActions}><button style={styles.btn} onClick={() => setDetail(null)}>Fechar</button></div>
          </div>
        </div>
      )}

      {qrModal.open && (
        <div style={styles.overlay} onClick={() => setQrModal({ open: false, channelId: null, qr: '' })}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>Conectar WhatsApp (WAHA)</h3>
            <ConnectionStateBanner state={currentConnectionState} error={connectionError} />
            <div style={{ textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 10, padding: 10 }}>
              {qrModal.qr ? <img src={qrModal.qr} alt="QR Code" style={{ width: 280, maxWidth: '100%' }} /> : <div style={styles.subtitle}>QR ainda não disponível</div>}
            </div>
            <div style={styles.formActions}><button style={styles.btn} onClick={() => setQrModal({ open: false, channelId: null, qr: '' })}>Fechar</button></div>
          </div>
        </div>
      )}

      <UpgradePlanModal
        open={planLimitModal.open}
        onClose={() => setPlanLimitModal({ open: false, reason: null })}
        reason={planLimitModal.reason}
        plan={plan}
        onViewPlan={() => {
          setPlanLimitModal({ open: false, reason: null });
          navigate('/');
        }}
      />

      {toast && <div style={{ position: 'fixed', right: 16, bottom: 16, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', borderRadius: 8, padding: '10px 12px', zIndex: 300 }}>{toast}</div>}
    </>
  );
}
