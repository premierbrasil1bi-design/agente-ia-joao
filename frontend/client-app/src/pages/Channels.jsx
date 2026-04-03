import { useEffect, useRef, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import { socket } from '../lib/socket.js';
import { agentApi } from '../services/agentApi.js';
import { channelsService } from '../services/channels.service.js';
import StatusBadge from '../components/StatusBadge.jsx';
import useAutoReconnect from '../hooks/useAutoReconnect.js';
import { useChannel } from '../context/ChannelContext.jsx';
import { useChannelConnection } from '../hooks/useChannelConnection.js';
import { ConnectionStateBanner } from '../components/ConnectionStateBanner.jsx';
import { CHANNEL_CONNECTION_STATE } from '../utils/channelCore.js';
import { CreateChannelCard } from '../components/CreateChannelCard.jsx';
import chLayout from './Channels.module.css';

const styles = {
  page: {
    padding: '1.5rem 2rem',
    display: 'flex',
    justifyContent: 'center',
  },
  content: {
    width: '100%',
    maxWidth: 1120,
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '1rem',
    flexWrap: 'wrap',
  },
  titleBlock: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
  },
  title: {
    margin: 0,
    fontSize: '1.6rem',
    fontWeight: 600,
    color: 'var(--text)',
  },
  subtitle: {
    margin: 0,
    fontSize: '0.9rem',
    color: 'var(--text-muted)',
  },
  primaryButton: {
    padding: '0.5rem 1.1rem',
    borderRadius: 999,
    border: 'none',
    background: 'var(--accent)',
    color: '#fff',
    fontSize: '0.9rem',
    fontWeight: 500,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.4rem',
  },
  card: {
    background: 'var(--surface)',
    borderRadius: 12,
    border: '1px solid var(--border)',
    padding: '1.25rem 1.5rem',
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '0.75rem',
    gap: '0.75rem',
    flexWrap: 'wrap',
  },
  cardTitle: {
    margin: 0,
    fontSize: '1rem',
    fontWeight: 600,
    color: 'var(--text)',
  },
  cardSubtitle: {
    margin: 0,
    fontSize: '0.8rem',
    color: 'var(--text-muted)',
  },
  channelsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
  },
  channelCard: {
    borderRadius: 10,
    border: '1px solid var(--border)',
    padding: '0.85rem 1rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
  },
  channelRowTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '0.75rem',
    flexWrap: 'wrap',
  },
  channelName: {
    fontSize: '0.95rem',
    fontWeight: 600,
    color: 'var(--text)',
  },
  channelMeta: {
    fontSize: '0.8rem',
    color: 'var(--text-muted)',
  },
  headerBadges: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    flexWrap: 'wrap',
  },
  typeBadge: {
    padding: '0.15rem 0.6rem',
    borderRadius: 999,
    border: '1px solid var(--border)',
    fontSize: '0.75rem',
    color: 'var(--text-muted)',
  },
  channelRowBottom: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '0.75rem',
    flexWrap: 'wrap',
  },
  actionsRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '0.75rem',
    flexWrap: 'wrap',
  },
  actionButton: {
    padding: '0.35rem 0.9rem',
    borderRadius: 999,
    border: '1px solid var(--border)',
    background: 'transparent',
    color: 'var(--text)',
    fontSize: '0.8rem',
    cursor: 'pointer',
  },
  actionButtonPrimary: {
    borderColor: 'var(--accent)',
    background: 'rgba(88,166,255,0.12)',
    color: 'var(--accent)',
  },
  /** CTA principal na lista — conectar WhatsApp */
  btnConnectWhatsapp: {
    padding: '0.5rem 1.2rem',
    borderRadius: 10,
    border: '1px solid var(--accent)',
    background: 'linear-gradient(180deg, rgba(88,166,255,0.22) 0%, rgba(88,166,255,0.1) 100%)',
    color: 'var(--accent)',
    fontSize: '0.8125rem',
    fontWeight: 600,
    cursor: 'pointer',
    width: '100%',
    maxWidth: '16rem',
    boxShadow: '0 2px 14px rgba(88, 166, 255, 0.18)',
    transition: 'filter 0.15s ease, box-shadow 0.15s ease',
  },
  actionButtonMuted: {
    borderColor: 'var(--border)',
    color: 'var(--text-muted)',
  },
  emptyState: {
    padding: '1.75rem 1.5rem',
    borderRadius: 10,
    border: '1px dashed var(--border)',
    textAlign: 'center',
    fontSize: '0.9rem',
    color: 'var(--text-muted)',
  },
  formRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
  },
  formRowResponsive: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.75rem',
  },
  field: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
  },
  label: {
    fontSize: '0.8rem',
    color: 'var(--text-muted)',
  },
  input: {
    width: '100%',
    padding: '0.45rem 0.6rem',
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'transparent',
    color: 'var(--text)',
    fontSize: '0.9rem',
  },
  select: {
    width: '100%',
    padding: '0.45rem 0.6rem',
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'transparent',
    color: 'var(--text)',
    fontSize: '0.9rem',
  },
  formActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '0.5rem',
    marginTop: '0.75rem',
    flexWrap: 'wrap',
  },
  buttonSecondary: {
    padding: '0.4rem 0.9rem',
    borderRadius: 999,
    border: '1px solid var(--border)',
    background: 'transparent',
    color: 'var(--text)',
    fontSize: '0.85rem',
    cursor: 'pointer',
  },
  buttonPrimary: {
    padding: '0.4rem 1rem',
    borderRadius: 999,
    border: 'none',
    background: 'var(--accent)',
    color: '#fff',
    fontSize: '0.85rem',
    fontWeight: 500,
    cursor: 'pointer',
  },
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 120,
    padding: '1rem',
  },
  modalCard: {
    background: 'var(--surface)',
    borderRadius: 12,
    border: '1px solid var(--border)',
    padding: '1.5rem',
    width: '100%',
    maxWidth: 420,
  },
  modalTitle: {
    margin: '0 0 0.75rem',
    fontSize: '1.05rem',
    fontWeight: 600,
    color: 'var(--text)',
  },
  modalFooter: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '0.5rem',
    marginTop: '1rem',
  },
};

export function Channels() {
  const { setChannel: setActiveUiChannel } = useChannel();

  const [channels, setChannels] = useState([]);
  const [agents, setAgents] = useState([]);
  const [name, setName] = useState('');
  const [agentId, setAgentId] = useState('');
  const [channelType, setChannelType] = useState('whatsapp');
  const [whatsappProvider, setWhatsappProvider] = useState('evolution');
  const [allowedProviders, setAllowedProviders] = useState(['evolution', 'waha', 'zapi']);
  const [evolutionInstanceNames, setEvolutionInstanceNames] = useState([]);
  const [whatsappInstanceSelect, setWhatsappInstanceSelect] = useState('');
  const [whatsappInstanceManual, setWhatsappInstanceManual] = useState('');
  const [qrCode, setQrCode] = useState(null);
  const [loadingCreate, setLoadingCreate] = useState(false);
  const [loadingQr, setLoadingQr] = useState(null);
  const [loadingConnectId, setLoadingConnectId] = useState(null);
  const [loadingProvisionId, setLoadingProvisionId] = useState(null);
  const [whatsappAdvanced, setWhatsappAdvanced] = useState(false);
  const [pairingModal, setPairingModal] = useState(null);
  const artifactPollRefs = useRef({});
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [deleteChannel, setDeleteChannel] = useState(null);
  const [editChannel, setEditChannel] = useState(null);
  const [editName, setEditName] = useState('');
  const [editType, setEditType] = useState('whatsapp');
  const [editAgentId, setEditAgentId] = useState('');
  const [loadingDeleteId, setLoadingDeleteId] = useState(null);
  const [loadingToggleId, setLoadingToggleId] = useState(null);
  const [loadingEditId, setLoadingEditId] = useState(null);
  const pollingRefs = useRef({});
  const {
    qrCode: liveQrCode,
    connectionState,
    error: connectionError,
    startConnection,
    stopConnection,
    connectStepMessage,
    setConnectStepMessage,
  } = useChannelConnection();

  /** Banner pós-criação (dismissível) */
  const [createSuccessKind, setCreateSuccessKind] = useState(null);

  async function loadChannels() {
    const data = await channelsService.listAgentChannels();
    setChannels(Array.isArray(data) ? data : []);
  }

  async function loadAgents() {
    const data = await agentApi.request('/api/agent/agents');
    setAgents(Array.isArray(data) ? data : []);
  }

  async function loadAllowedProviders() {
    try {
      const data = await channelsService.getAllowedProviders();
      const list = Array.isArray(data?.allowedProviders) ? data.allowedProviders : [];
      if (list.length > 0) {
        setAllowedProviders(list);
        if (!list.includes(whatsappProvider)) {
          setWhatsappProvider(list[0]);
        }
      }
    } catch (e) {
      console.warn('[channels] allowed providers:', e.message);
    }
  }

  function resolveProviderErrorMessage(err) {
    const code = err?.code || err?.error || '';
    const msg = String(err?.message || '');
    if (code === 'PROVIDER_NOT_ALLOWED' || msg.includes('PROVIDER_NOT_ALLOWED')) {
      return 'Este provider não está liberado para o seu plano.';
    }
    if (code === 'NO_ALLOWED_PROVIDER_AVAILABLE' || msg.includes('NO_ALLOWED_PROVIDER_AVAILABLE')) {
      return 'Nenhum provider permitido está disponível no momento.';
    }
    return err?.message || 'Operação não permitida para o provider selecionado.';
  }

  useEffect(() => {
    if (channelType !== 'whatsapp' || !whatsappAdvanced || whatsappProvider !== 'evolution') {
      setEvolutionInstanceNames([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await channelsService.listEvolutionInstances();
        if (!cancelled && data?.instanceNames && Array.isArray(data.instanceNames)) {
          setEvolutionInstanceNames(data.instanceNames);
        }
      } catch (e) {
        console.warn('[channels] listEvolutionInstances:', e.message);
        if (!cancelled) setEvolutionInstanceNames([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [channelType, whatsappAdvanced, whatsappProvider]);

  function stopArtifactPolling(channelId) {
    const id = channelId;
    if (artifactPollRefs.current[id]) {
      clearInterval(artifactPollRefs.current[id]);
      delete artifactPollRefs.current[id];
    }
  }

  function applyArtifactPayload(channelId, data) {
    if (data?.artifactType === 'pairing_code' && data?.artifact) {
      const code = String(data.artifact).trim();
      setPairingModal({ code, channelId });
      sessionStorage.setItem(`pairing_${channelId}`, code);
      setQrCode(null);
      return;
    }
    const src = data?.artifact || data?.qr || data?.qrcode;
    if (!src || (typeof src === 'string' && !src.trim())) return;
    const raw = typeof src === 'string' ? src : src?.base64 ?? src?.code ?? '';
    if (!raw || (typeof raw === 'string' && !raw.trim())) return;
    const qr =
      raw.startsWith('data:image') || /^https?:\/\//i.test(raw)
        ? raw
        : `data:image/png;base64,${raw.replace(/^data:image\/\w+;base64,/, '')}`;
    sessionStorage.setItem(`qr_${channelId}`, qr);
    setQrCode(qr);
    setPairingModal(null);
  }

  async function runSaasProvisionConnect(channelId) {
    setLoadingProvisionId(channelId);
    setConnectStepMessage('Preparando instância…');
    try {
      await channelsService.provisionInstance(channelId);
      setConnectStepMessage('Aguardando conexão…');
      const cr = await channelsService.connectChannel(channelId);
      if (cr?.skippedDueToCooldown) {
        toast(cr?.message || 'Aguarde alguns segundos antes de conectar de novo.');
      }
      if (cr?.artifactType && cr?.artifact) {
        applyArtifactPayload(channelId, cr);
      }
      startArtifactPolling(channelId);
      startPolling(channelId);
      await loadChannels();
    } catch (err) {
      console.error(err);
      toast.error(resolveProviderErrorMessage(err));
    } finally {
      setLoadingProvisionId(null);
      setConnectStepMessage('');
    }
  }

  function startArtifactPolling(channelId) {
    if (artifactPollRefs.current[channelId]) return;
    artifactPollRefs.current[channelId] = setInterval(async () => {
      try {
        const d = await channelsService.getConnectionArtifact(channelId);
        if (String(d.status || '').toLowerCase() === 'connected') {
          stopArtifactPolling(channelId);
          await loadChannels();
          toast.success('WhatsApp conectado.');
          setQrCode(null);
          setPairingModal(null);
          return;
        }
        if (d.artifactType && d.artifact) {
          applyArtifactPayload(channelId, d);
        }
      } catch (e) {
        console.warn('[channels] artifact poll:', e.message);
      }
    }, 2800);
  }

  async function createChannel() {
    if (!agentId) {
      toast.error('Selecione um agente');
      return;
    }
    if (channelType === 'whatsapp') {
      if (!allowedProviders.length) {
        toast.error('Nenhum provider permitido está disponível no momento.');
        return;
      }
      if (!name.trim()) {
        toast.error('Informe o nome do canal');
        return;
      }
      if (whatsappAdvanced) {
        const instRaw = (whatsappInstanceManual || whatsappInstanceSelect || '').trim();
        if (!instRaw) {
          toast.error('Com “instância existente”, informe ou selecione a instância no provedor.');
          return;
        }
      }
    } else if (!name || !agentId) {
      toast.error('Preencha todos os campos');
      return;
    }

    const createdAsWhatsapp = channelType === 'whatsapp';

    setLoadingCreate(true);
    try {
      const payload = {
        name: name.trim(),
        agentId,
        type: channelType,
      };
      if (channelType === 'whatsapp') {
        payload.provider = whatsappProvider || allowedProviders[0];
      }
      if (channelType === 'whatsapp' && whatsappAdvanced) {
        const inst = (whatsappInstanceManual || whatsappInstanceSelect || '').trim().replace(/\s+/g, '-');
        payload.instance = inst;
      }

      await channelsService.createChannel(payload);

      setName('');
      setAgentId('');
      setChannelType('whatsapp');
      setWhatsappProvider('evolution');
      setWhatsappInstanceSelect('');
      setWhatsappInstanceManual('');
      setWhatsappAdvanced(false);

      await loadChannels();

      setCreateSuccessKind(createdAsWhatsapp ? 'whatsapp' : 'other');
      toast.success(
        createdAsWhatsapp
          ? 'Canal WhatsApp criado. Conecte na lista à esquerda quando estiver pronto.'
          : 'Canal criado com sucesso.',
      );
    } catch (err) {
      console.error(err);
      toast.error(resolveProviderErrorMessage(err));
    } finally {
      setLoadingCreate(false);
    }
  }

  function restoreQr(channelId) {
    const saved = sessionStorage.getItem(`qr_${channelId}`);
    if (saved) {
      setQrCode(saved);
    }
  }

  function restorePairingOrQr(channelId) {
    restoreQr(channelId);
    const p = sessionStorage.getItem(`pairing_${channelId}`);
    if (p) setPairingModal({ code: p, channelId });
  }

  function applyQrFromResponse(channelId, data) {
    const src = data?.qr || data?.qrcode;
    if (!src || (typeof src === 'string' && !src.trim())) {
      throw new Error(data?.error || 'QR não disponível ainda');
    }
    const raw = typeof src === 'string' ? src : src?.base64 ?? src?.code ?? '';
    if (!raw || (typeof raw === 'string' && !raw.trim())) {
      throw new Error(data?.error || 'QR não disponível ainda');
    }
    const qr = raw.startsWith('data:image') || /^https?:\/\//i.test(raw)
      ? raw
      : `data:image/png;base64,${raw.replace(/^data:image\/\w+;base64,/, '')}`;
    sessionStorage.setItem(`qr_${channelId}`, qr);
    setQrCode(qr);
  }

  /** Só busca QR (instância já criada / já em pairing). */
  async function getQr(channelId) {
    setLoadingQr(channelId);
    try {
      const data = await channelsService.getQrCode(channelId);
      applyQrFromResponse(channelId, data);
      startPolling(channelId);
    } catch (err) {
      console.error(err);
      toast.error(resolveProviderErrorMessage(err));
    } finally {
      setLoadingQr(null);
    }
  }

  /** Conecta (sem recriar instância) e obtém QR ou código de pareamento. */
  async function connectThenQr(channelId) {
    setLoadingConnectId(channelId);
    try {
      await startConnection(channelId);
      toast.success('Aguardando leitura...');
    } catch (err) {
      console.error(err);
      toast.error(resolveProviderErrorMessage(err));
    } finally {
      setLoadingConnectId(null);
    }
  }

  async function refreshArtifact(channelId) {
    setLoadingQr(channelId);
    try {
      const art = await channelsService.getConnectionArtifact(channelId);
      if (art?.artifactType && art?.artifact) {
        applyArtifactPayload(channelId, art);
      } else if (art?.status === 'connected') {
        toast.success('WhatsApp já está conectado.');
        await loadChannels();
      } else {
        toast(art?.message || 'A conexão do WhatsApp ainda está aguardando QR ou código.');
      }
      startArtifactPolling(channelId);
      startPolling(channelId);
    } catch (err) {
      console.error(err);
      toast.error(resolveProviderErrorMessage(err));
    } finally {
      setLoadingQr(null);
    }
  }

  const startPolling = useCallback((channelId) => {
    if (pollingRefs.current[channelId]) return;

    pollingRefs.current[channelId] = setInterval(async () => {
      try {
        const data = await channelsService.getStatus(channelId);
        const nextStatus = data.normalizedStatus ?? data.status;
        const updated = data.channel;

        setChannels((prev) =>
          prev.map((ch) => {
            if (ch.id !== channelId) return ch;
            if (updated && typeof updated === 'object') {
              return { ...ch, ...updated, status: nextStatus ?? ch.status };
            }
            return { ...ch, status: nextStatus ?? ch.status };
          }),
        );

        const pub = String(data.publicStatus || '').toLowerCase();
        const ns = String(nextStatus || '').toLowerCase();
        if (pub === 'connected' || ns === 'connected' || ns === 'open') {
          clearInterval(pollingRefs.current[channelId]);
          delete pollingRefs.current[channelId];
          stopArtifactPolling(channelId);
          toast.success('WhatsApp conectado.');
          setQrCode(null);
          setPairingModal(null);
        }
      } catch (e) {
        console.warn('[channels] polling status:', e.message);
      }
    }, 3000);
  }, []);

  useAutoReconnect(channels, startPolling);

  useEffect(() => {
    try {
      const v = (localStorage.getItem('channel') || 'web').toLowerCase();
      if (v === 'web') setActiveUiChannel('whatsapp');
    } catch {
      /* ignore */
    }
  }, [setActiveUiChannel]);

  useEffect(() => {
    if (liveQrCode) {
      setQrCode(liveQrCode);
      setPairingModal(null);
    }
    if (connectionState === CHANNEL_CONNECTION_STATE.CONNECTED) {
      toast.success('Conectado com sucesso');
      setQrCode(null);
      setPairingModal(null);
      loadChannels();
    }
  }, [liveQrCode, connectionState]);

  useEffect(() => {
    loadChannels();
    loadAgents();
    loadAllowedProviders();

    socket.on('channel_status_update', ({ channelId, status }) => {
      setChannels((prev) =>
        prev.map((ch) => (ch.id === channelId ? { ...ch, status } : ch)),
      );
    });

    return () => {
      stopConnection();
      socket.off('channel_status_update');
      Object.values(pollingRefs.current).forEach(clearInterval);
      Object.values(artifactPollRefs.current).forEach(clearInterval);
    };
  }, [stopConnection]);

  const agentMap = Object.fromEntries((agents || []).map((a) => [a.id, a]));
  const getAgentName = (id) => agentMap[id]?.name || '—';

  const getChannelTypeLabel = (type) => {
    const t = (type || '').toLowerCase();
    if (t === 'whatsapp') return 'WhatsApp';
    if (t === 'instagram') return 'Instagram';
    if (t === 'telegram') return 'Telegram';
    if (t === 'web') return 'Web Chat';
    if (t === 'api') return 'API / Webhook';
    return 'Outro';
  };

  const getChannelContextText = (ch) => {
    const t = (ch.type || '').toLowerCase();
    const s = (ch.status || '').toLowerCase();

    if (t === 'whatsapp') {
      const fp = ch.flowPhase;
      if (fp === 'draft') {
        return 'Canal criado. Use “Preparar WhatsApp” ou crie outro canal — a instância será gerada automaticamente.';
      }
      if (fp === 'provisioning') {
        return 'Preparando instância… aguarde.';
      }
      if (fp === 'error') {
        return 'Não foi possível provisionar a instância. Use “Tentar de novo” ou contate o suporte.';
      }
      if (fp === 'awaiting_connection') {
        return 'Aguardando conexão: escaneie o QR ou use o código de pareamento no WhatsApp.';
      }
      if (fp === 'connected' || s === 'connected' || s === 'open') {
        return 'Canal WhatsApp conectado. Mensagens serão roteadas automaticamente para o agente vinculado.';
      }
      if (s === 'connecting') {
        return 'Escaneie o QR Code no WhatsApp para finalizar a conexão desta instância.';
      }
      if (s === 'created') {
        return 'Instância pronta. Gere o QR Code ou código e conecte o WhatsApp.';
      }
      if (s === 'error') {
        return 'Houve um erro na conexão. Verifique o canal ou tente preparar de novo.';
      }
      return 'Use “Conectar WhatsApp” na lista para iniciar a sessão (fluxo automático no painel).';
    }
    if (t === 'instagram') {
      return 'Conecte sua conta Instagram via Meta OAuth para receber e responder mensagens do Direct.';
    }
    if (t === 'telegram') {
      return 'Informe o token do bot do Telegram para habilitar o atendimento neste canal.';
    }
    if (t === 'web') {
      return 'Instale o widget de chat no seu site utilizando o script deste canal.';
    }
    if (t === 'api') {
      return 'Use o endpoint de webhook para integrar fontes externas de mensagem ao agente.';
    }
    return 'Canal em configuração. Defina o tipo e complete as credenciais para ativá-lo.';
  };

  const renderTypeActions = (ch) => {
    const t = (ch.type || '').toLowerCase();
    if (t === 'whatsapp') {
      const phase = ch.flowPhase;
      const st = (ch.status || '').toLowerCase();
      const busy =
        loadingConnectId === ch.id ||
        loadingQr === ch.id ||
        loadingCreate ||
        loadingProvisionId === ch.id ||
        (connectionState === CHANNEL_CONNECTION_STATE.GENERATING_QR && loadingConnectId === ch.id);
      const isConnected =
        st === 'connected' ||
        st === 'open' ||
        phase === 'connected' ||
        (connectionState === CHANNEL_CONNECTION_STATE.CONNECTED && loadingConnectId === ch.id);

      if (phase === 'draft' || phase === 'error') {
        return (
          <button
            type="button"
            style={{ ...styles.actionButton, ...styles.actionButtonPrimary }}
            disabled={busy}
            onClick={() => runSaasProvisionConnect(ch.id)}
          >
            {loadingProvisionId === ch.id
              ? 'Preparando…'
              : phase === 'error'
                ? 'Tentar de novo'
                : 'Preparar WhatsApp'}
          </button>
        );
      }

      const showConnect =
        !isConnected &&
        (phase === 'awaiting_connection' ||
          phase == null ||
          ['created', 'connecting', 'disconnected', 'close', 'unknown', ''].includes(st) ||
          !ch.status);

      const showArtifactBtn =
        !isConnected &&
        (st === 'connecting' ||
          st === 'created' ||
          phase === 'awaiting_connection' ||
          (phase == null && ch.external_id));

      return (
        <>
          {showConnect && (
            <button
              type="button"
              style={styles.btnConnectWhatsapp}
              disabled={busy}
              onClick={() => {
                restorePairingOrQr(ch.id);
                connectThenQr(ch.id);
              }}
            >
              {isConnected
                ? 'Conectado'
                : loadingConnectId === ch.id || connectionState === CHANNEL_CONNECTION_STATE.GENERATING_QR
                  ? 'Gerando QR Code…'
                  : 'Conectar WhatsApp'}
            </button>
          )}
          {showArtifactBtn && (
            <button
              type="button"
              style={styles.actionButton}
              disabled={busy}
              onClick={() => {
                restorePairingOrQr(ch.id);
                refreshArtifact(ch.id);
              }}
            >
              {loadingQr === ch.id ? 'Atualizando...' : 'Ver QR / código'}
            </button>
          )}
        </>
      );
    }
    if (t === 'instagram') {
      return (
        <button
          type="button"
          style={{
            ...styles.actionButton,
            ...styles.actionButtonPrimary,
          }}
          onClick={() =>
            toast('Fluxo de conexão Instagram (Meta OAuth) será configurado aqui.')
          }
        >
          Conectar via Meta OAuth
        </button>
      );
    }
    if (t === 'telegram') {
      return (
        <button
          type="button"
          style={styles.actionButton}
          onClick={() =>
            toast('Configuração de token do bot Telegram será exibida aqui.')
          }
        >
          Configurar token do bot
        </button>
      );
    }
    if (t === 'web') {
      return (
        <button
          type="button"
          style={styles.actionButton}
          onClick={async () => {
            const snippet = '<script src="https://api.omnia1biai.com.br/widget.js" data-channel-id="' + ch.id + '"></script>';
            try {
              await navigator.clipboard.writeText(snippet);
              toast.success('Snippet do widget copiado para a área de transferência.');
            } catch {
              toast.error('Não foi possível copiar o snippet. Copie manualmente.');
            }
          }}
        >
          Copiar script do widget
        </button>
      );
    }
    if (t === 'api') {
      return (
        <button
          type="button"
          style={styles.actionButton}
          onClick={() => {
            const endpoint = `/api/inbound/${ch.id}`;
            toast(`Endpoint do webhook: ${endpoint}`);
          }}
        >
          Ver endpoint do webhook
        </button>
      );
    }
    return null;
  };

  const renderSecondaryActions = (ch) => (
    <>
      <button
        type="button"
        style={styles.actionButton}
        onClick={() => openEditModal(ch)}
      >
        {loadingEditId === ch.id ? 'Salvando...' : 'Editar'}
      </button>
      <button
        type="button"
        style={{
          ...styles.actionButton,
          ...styles.actionButtonMuted,
        }}
        disabled={loadingToggleId === ch.id}
        onClick={() => handleToggleActive(ch)}
      >
        {loadingToggleId === ch.id ? 'Atualizando...' : 'Ativar/Desativar'}
      </button>
    </>
  );

  const renderDangerAction = (ch) => (
    <button
      type="button"
      style={{
        ...styles.actionButton,
        borderColor: 'var(--danger)',
        color: 'var(--danger)',
      }}
      onClick={() => setDeleteChannel(ch)}
    >
      Excluir
    </button>
  );

  const getLastActivity = (ch) => {
    const ts = ch.updated_at || ch.connected_at || ch.created_at;
    if (!ts) return '—';
    const d = new Date(ts);
    const diffMs = Date.now() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'agora';
    if (diffMin < 60) return `há ${diffMin} min`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `há ${diffH} h`;
    const diffD = Math.floor(diffH / 24);
    return `há ${diffD} d`;
  };

  const filteredChannels = channels.filter((ch) => {
    const term = searchTerm.trim().toLowerCase();
    if (term) {
      const hay = `${ch.name || ''} ${ch.instance || ''} ${ch.id || ''}`.toLowerCase();
      if (!hay.includes(term)) return false;
    }
    if (filterType !== 'all') {
      if ((ch.type || '').toLowerCase() !== filterType) return false;
    }
    if (filterStatus !== 'all') {
      if ((ch.status || '').toLowerCase() !== filterStatus) return false;
    }
    return true;
  });

  const statusSummary = channels.reduce(
    (acc, ch) => {
      const status = String(ch.status || '').toLowerCase();
      if (status === 'connected' || status === 'open') {
        acc.online += 1;
      } else if (status === 'connecting' || status === 'created') {
        acc.unstable += 1;
      } else {
        acc.offline += 1;
      }
      return acc;
    },
    { online: 0, unstable: 0, offline: 0 },
  );

  const openEditModal = (ch) => {
    setEditChannel(ch);
    setEditName(ch.name || ch.instance || '');
    setEditType((ch.type || 'whatsapp').toLowerCase());
    setEditAgentId(ch.agent_id || '');
  };

  const closeEditModal = () => {
    setEditChannel(null);
    setEditName('');
    setEditType('whatsapp');
    setEditAgentId('');
  };

  const handleDeleteConfirm = async () => {
    if (!deleteChannel) return;
    const id = deleteChannel.id;
    try {
      setLoadingDeleteId(id);
      await channelsService.deleteChannel(id);
      setChannels((prev) => prev.filter((c) => c.id !== id));
      setDeleteChannel(null);
      toast.success('Canal excluído com sucesso.');
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Erro ao excluir canal.');
    } finally {
      setLoadingDeleteId(null);
    }
  };

  const handleToggleActive = async (ch) => {
    const id = ch.id;
    const currentlyOn = ch.active !== false;
    const nextActive = !currentlyOn;
    try {
      setLoadingToggleId(id);
      const updated = await channelsService.updateChannel(id, { active: nextActive });
      setChannels((prev) =>
        prev.map((c) => (c.id === id ? { ...c, ...updated } : c)),
      );
      toast.success(nextActive ? 'Canal ativado.' : 'Canal desativado.');
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Erro ao atualizar status do canal.');
    } finally {
      setLoadingToggleId(null);
    }
  };

  const handleEditSave = async () => {
    if (!editChannel) return;
    const id = editChannel.id;
    try {
      setLoadingEditId(id);
      const updated = await channelsService.updateChannel(id, {
        name: editName,
        type: editType,
        agent_id: editAgentId,
      });
      setChannels((prev) =>
        prev.map((c) => (c.id === id ? { ...c, ...updated } : c)),
      );
      toast.success('Canal atualizado com sucesso.');
      closeEditModal();
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Erro ao atualizar canal.');
    } finally {
      setLoadingEditId(null);
    }
  };

  return (
    <div className={chLayout.page}>
      <div className={chLayout.content}>
        <header className={chLayout.header}>
          <h1 className={chLayout.title}>Canais</h1>
          <p className={chLayout.subtitle}>
            Centralize o atendimento: veja seus canais à esquerda e crie novos à direita. A conexão (QR, etc.) fica na
            lista — não é automática após criar.
          </p>
          {connectionState !== CHANNEL_CONNECTION_STATE.IDLE ? (
            <ConnectionStateBanner state={connectionState} error={connectionError} />
          ) : null}
          {channelType === 'whatsapp' && allowedProviders.length === 0 ? (
            <p className={chLayout.providerWarn}>
              Nenhum provider de WhatsApp está liberado para este tenant/plano.
            </p>
          ) : null}
        </header>

        <section className={chLayout.statsCard}>
          <div className={chLayout.statsGrid}>
            <div className={chLayout.statCell}>
              <div className={chLayout.statLabel}>Online</div>
              <div className={chLayout.statValue} style={{ color: 'var(--success)' }}>
                {statusSummary.online}
              </div>
            </div>
            <div className={chLayout.statCell}>
              <div className={chLayout.statLabel}>Instável</div>
              <div className={chLayout.statValue} style={{ color: 'var(--warning)' }}>
                {statusSummary.unstable}
              </div>
            </div>
            <div className={chLayout.statCell}>
              <div className={chLayout.statLabel}>Offline</div>
              <div className={chLayout.statValue} style={{ color: 'var(--danger)' }}>
                {statusSummary.offline}
              </div>
            </div>
          </div>
        </section>

        <div className={chLayout.mainGrid}>
          <section className={chLayout.listCard}>
            {createSuccessKind ? (
              <div className={chLayout.successBanner} role="status">
                <div className={chLayout.successBannerBody}>
                  <p className={chLayout.successBannerTitle}>Canal criado com sucesso</p>
                  <p className={chLayout.successBannerText}>
                    {createSuccessKind === 'whatsapp'
                      ? 'Na lista abaixo, use “Preparar WhatsApp” (se aparecer) e em seguida “Conectar WhatsApp” para escanear o QR ou parear o número.'
                      : 'O canal já aparece na lista. Configure ou conecte conforme o tipo escolhido.'}
                  </p>
                </div>
                <button
                  type="button"
                  className={chLayout.successBannerDismiss}
                  aria-label="Fechar aviso"
                  onClick={() => setCreateSuccessKind(null)}
                >
                  Fechar
                </button>
              </div>
            ) : null}
            {loadingProvisionId && connectStepMessage ? (
              <p className={chLayout.provisionHint}>{connectStepMessage}</p>
            ) : null}
            <div className={chLayout.listHeader}>
              <div>
                <h2 className={chLayout.listTitle}>Seus canais</h2>
                <p className={chLayout.listSubtitle}>
                  Filtre, conecte ou edite. O formulário de criação fica na coluna ao lado.
                </p>
              </div>
              <div className={chLayout.filters}>
                <input
                  className={chLayout.filterInput}
                  style={styles.input}
                  placeholder="Buscar canal..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
                <select
                  className={chLayout.filterSelect}
                  style={styles.select}
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                >
                  <option value="all">Tipo: Todos</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="instagram">Instagram</option>
                  <option value="telegram">Telegram</option>
                  <option value="web">Web Chat</option>
                  <option value="api">API/Webhook</option>
                </select>
                <select
                  className={chLayout.filterSelect}
                  style={styles.select}
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                >
                  <option value="all">Status: Todos</option>
                  <option value="connected">Conectado</option>
                  <option value="connecting">Conectando</option>
                  <option value="created">Criado</option>
                  <option value="offline">Offline</option>
                  <option value="error">Erro</option>
                </select>
              </div>
            </div>

            {filteredChannels.length === 0 ? (
              <div style={styles.emptyState}>
                <div style={{ marginBottom: '0.5rem', fontWeight: 500 }}>Nenhum canal ainda.</div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  Use o painel <strong style={{ color: 'var(--text)' }}>Criar novo canal</strong> para cadastrar o
                  primeiro. Em seguida, conecte pelo botão <strong style={{ color: 'var(--text)' }}>Conectar WhatsApp</strong>{' '}
                  na lista (ou a ação equivalente ao tipo do canal).
                </div>
              </div>
            ) : (
              <div style={styles.channelsList}>
                {filteredChannels.map((ch) => (
                  <div key={ch.id} style={styles.channelCard}>
                    <div style={styles.channelRowTop}>
                      <div>
                        <div style={styles.channelName}>{ch.instance || ch.name}</div>
                        <div style={styles.channelMeta}>
                          {getChannelTypeLabel(ch.type)} · {getAgentName(ch.agent_id)}
                        </div>
                      </div>
                      <div style={styles.headerBadges}>
                        <span style={styles.typeBadge}>{getChannelTypeLabel(ch.type)}</span>
                        <StatusBadge status={ch.status} />
                      </div>
                    </div>

                    <div style={styles.channelRowBottom}>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        {getChannelContextText(ch)}
                        <div style={{ marginTop: '0.15rem', fontSize: '0.75rem', opacity: 0.8 }}>
                          Última atividade: {getLastActivity(ch)}
                        </div>
                      </div>
                      <div style={styles.actionsRow}>
                        <div className={chLayout.channelActionsPrimary}>
                          <div className={chLayout.channelActionsType}>
                            {renderTypeActions(ch)}
                          </div>
                          <div className={chLayout.channelActionsSecondary}>
                            {renderSecondaryActions(ch)}
                          </div>
                        </div>
                        <div>
                          {renderDangerAction(ch)}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className={chLayout.createColumn}>
            <div className={chLayout.createColumnInner}>
              <CreateChannelCard
                name={name}
                setName={setName}
                agentId={agentId}
                setAgentId={setAgentId}
                channelType={channelType}
                onChannelTypeChange={(v) => {
                  setChannelType(v);
                  if (v !== 'whatsapp') setWhatsappProvider('evolution');
                  setWhatsappInstanceSelect('');
                  setWhatsappInstanceManual('');
                  setWhatsappAdvanced(false);
                }}
                whatsappProvider={whatsappProvider}
                onWhatsappProviderChange={(v) => {
                  setWhatsappProvider(v);
                  setWhatsappInstanceSelect('');
                  setWhatsappInstanceManual('');
                  if (v !== 'evolution') setWhatsappAdvanced(false);
                }}
                allowedProviders={allowedProviders}
                whatsappAdvanced={whatsappAdvanced}
                setWhatsappAdvanced={setWhatsappAdvanced}
                evolutionInstanceNames={evolutionInstanceNames}
                whatsappInstanceSelect={whatsappInstanceSelect}
                setWhatsappInstanceSelect={setWhatsappInstanceSelect}
                whatsappInstanceManual={whatsappInstanceManual}
                setWhatsappInstanceManual={setWhatsappInstanceManual}
                agents={agents}
                loadingCreate={loadingCreate}
                onSubmit={createChannel}
                onClear={() => {
                  setName('');
                  setAgentId('');
                  setWhatsappProvider('evolution');
                  setWhatsappInstanceSelect('');
                  setWhatsappInstanceManual('');
                  setWhatsappAdvanced(false);
                }}
                providersBlocked={channelType === 'whatsapp' && allowedProviders.length === 0}
              />
            </div>
          </div>
        </div>

        {qrCode && (
          <div
            style={styles.modalOverlay}
            onClick={() => setQrCode(null)}
          >
            <div
              style={styles.modalCard}
              onClick={(e) => e.stopPropagation()}
            >
              <h2 style={styles.modalTitle}>QR Code</h2>
              <div style={{ textAlign: 'center', marginTop: '0.5rem' }}>
                <img
                  src={qrCode}
                  alt="QR Code"
                  style={{ maxWidth: '100%', borderRadius: 8 }}
                />
              </div>
              <div style={styles.modalFooter}>
                <ConnectionStateBanner state={connectionState} error={connectionError} />
                <button
                  type="button"
                  style={styles.buttonPrimary}
                  onClick={() => setQrCode(null)}
                >
                  Fechar
                </button>
                <button
                  type="button"
                  style={styles.buttonSecondary}
                  onClick={() => {
                    stopConnection();
                  }}
                >
                  Parar conexão
                </button>
              </div>
            </div>
          </div>
        )}

        {pairingModal && (
          <div
            style={styles.modalOverlay}
            onClick={() => setPairingModal(null)}
          >
            <div
              style={styles.modalCard}
              onClick={(e) => e.stopPropagation()}
            >
              <h2 style={styles.modalTitle}>Código de pareamento</h2>
              <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', margin: '0 0 0.75rem' }}>
                No WhatsApp: Configurações → Aparelhos conectados → Conectar um aparelho → use “Conectar com número” e
                informe o código abaixo.
              </p>
              <div
                style={{
                  fontSize: '1.4rem',
                  fontWeight: 700,
                  textAlign: 'center',
                  letterSpacing: '0.2em',
                  padding: '0.75rem',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  fontFamily: 'ui-monospace, monospace',
                }}
              >
                {pairingModal.code}
              </div>
              <div style={styles.modalFooter}>
                <button
                  type="button"
                  style={styles.buttonPrimary}
                  onClick={() => setPairingModal(null)}
                >
                  Fechar
                </button>
              </div>
            </div>
          </div>
        )}

        {deleteChannel && (
          <div
            style={styles.modalOverlay}
            onClick={() => setDeleteChannel(null)}
          >
            <div
              style={styles.modalCard}
              onClick={(e) => e.stopPropagation()}
            >
              <h2 style={styles.modalTitle}>Excluir canal</h2>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                Tem certeza que deseja excluir o canal{' '}
                <strong>{deleteChannel.instance || deleteChannel.name}</strong>? Esta ação
                não poderá ser desfeita.
              </p>
              <div style={styles.modalFooter}>
                <button
                  type="button"
                  style={styles.buttonSecondary}
                  onClick={() => setDeleteChannel(null)}
                  disabled={loadingDeleteId === deleteChannel.id}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  style={{
                    ...styles.buttonPrimary,
                    background: 'var(--danger)',
                  }}
                  onClick={handleDeleteConfirm}
                  disabled={loadingDeleteId === deleteChannel.id}
                >
                  {loadingDeleteId === deleteChannel.id ? 'Excluindo...' : 'Confirmar exclusão'}
                </button>
              </div>
            </div>
          </div>
        )}

        {editChannel && (
          <div
            style={styles.modalOverlay}
            onClick={closeEditModal}
          >
            <div
              style={styles.modalCard}
              onClick={(e) => e.stopPropagation()}
            >
              <h2 style={styles.modalTitle}>Editar canal</h2>
              <div style={styles.formRow}>
                <div style={styles.field}>
                  <label style={styles.label}>Nome do canal</label>
                  <input
                    style={styles.input}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                  />
                </div>
                <div style={styles.field}>
                  <label style={styles.label}>Tipo de canal</label>
                  <select
                    style={styles.select}
                    value={editType}
                    onChange={(e) => setEditType(e.target.value)}
                  >
                    <option value="whatsapp">WhatsApp</option>
                    <option value="instagram">Instagram</option>
                    <option value="telegram">Telegram</option>
                    <option value="web">Web Chat</option>
                    <option value="api">API / Webhook</option>
                  </select>
                </div>
                <div style={styles.field}>
                  <label style={styles.label}>Agente</label>
                  <select
                    style={styles.select}
                    value={editAgentId}
                    onChange={(e) => setEditAgentId(e.target.value)}
                  >
                    <option value="">Selecione um agente</option>
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div style={styles.modalFooter}>
                <button
                  type="button"
                  style={styles.buttonSecondary}
                  onClick={closeEditModal}
                  disabled={loadingEditId === editChannel.id}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  style={styles.buttonPrimary}
                  onClick={handleEditSave}
                  disabled={loadingEditId === editChannel.id}
                >
                  {loadingEditId === editChannel.id ? 'Salvando...' : 'Salvar alterações'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
