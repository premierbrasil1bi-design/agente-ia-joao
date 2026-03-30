import { useEffect, useRef, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import { socket } from '../lib/socket.js';
import { agentApi } from '../services/agentApi.js';
import { channelsService } from '../services/channels.service.js';
import StatusBadge from '../components/StatusBadge.jsx';
import useAutoReconnect from '../hooks/useAutoReconnect.js';

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
  layoutGrid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1.2fr)',
    gap: '1.5rem',
  },
  layoutGridSingle: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr)',
    gap: '1.5rem',
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
  const [channels, setChannels] = useState([]);
  const [agents, setAgents] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState('');
  const [agentId, setAgentId] = useState('');
  const [channelType, setChannelType] = useState('whatsapp');
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
  const [connectStepMessage, setConnectStepMessage] = useState('');
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

  async function loadChannels() {
    const data = await channelsService.listAgentChannels();
    setChannels(Array.isArray(data) ? data : []);
  }

  async function loadAgents() {
    const data = await agentApi.request('/api/agent/agents');
    setAgents(Array.isArray(data) ? data : []);
  }

  useEffect(() => {
    if (channelType !== 'whatsapp' || !whatsappAdvanced) {
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
  }, [channelType, whatsappAdvanced]);

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
      toast.error(err.message || 'Erro no fluxo do WhatsApp.');
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
      if (!name.trim()) {
        toast.error('Informe o nome do canal');
        return;
      }
      if (whatsappAdvanced) {
        const instRaw = (whatsappInstanceManual || whatsappInstanceSelect || '').trim();
        if (!instRaw) {
          toast.error('No modo avançado, informe ou selecione a instância Evolution.');
          return;
        }
      }
    } else if (!name || !agentId) {
      toast.error('Preencha todos os campos');
      return;
    }

    setLoadingCreate(true);
    try {
      const payload = {
        name: name.trim(),
        agentId,
        type: channelType,
      };
      if (channelType === 'whatsapp') {
        payload.provider = 'evolution';
      }
      if (channelType === 'whatsapp' && whatsappAdvanced) {
        const inst = (whatsappInstanceManual || whatsappInstanceSelect || '').trim().replace(/\s+/g, '-');
        payload.instance = inst;
      }

      const data = await channelsService.createChannel(payload);
      const newId = data?.channel?.id;
      const next = data?.nextAction;

      setShowModal(false);
      setName('');
      setAgentId('');
      setChannelType('whatsapp');
      setWhatsappInstanceSelect('');
      setWhatsappInstanceManual('');
      setWhatsappAdvanced(false);

      await loadChannels();

      if (newId && channelType === 'whatsapp' && next === 'provision_instance') {
        toast.success('Canal criado. Preparando WhatsApp…');
        await runSaasProvisionConnect(newId);
      } else if (newId && channelType === 'whatsapp' && next === 'connect') {
        toast.success('Canal criado. Iniciando conexão…');
        await connectThenQr(newId);
      } else {
        toast.success('Canal criado com sucesso');
        if (newId) startPolling(newId);
      }
    } catch (err) {
      console.error(err);
      toast.error(err.message || 'Erro ao criar canal');
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
      toast.error(
        err.message?.includes('503') || err.message?.includes('offline')
          ? 'Evolution API indisponível. Verifique se o serviço está no ar.'
          : err.message || 'Erro ao obter QR Code.',
      );
    } finally {
      setLoadingQr(null);
    }
  }

  /** Conecta (sem recriar instância) e obtém QR ou código de pareamento. */
  async function connectThenQr(channelId) {
    setLoadingConnectId(channelId);
    try {
      const cr = await channelsService.connectChannel(channelId);
      if (cr?.skippedDueToCooldown) {
        toast(cr?.message || 'Aguarde alguns segundos antes de conectar de novo.');
      }
      if (cr?.artifactType && cr?.artifact) {
        applyArtifactPayload(channelId, cr);
      } else {
        try {
          const art = await channelsService.getConnectionArtifact(channelId);
          if (art?.artifactType && art?.artifact) {
            applyArtifactPayload(channelId, art);
          } else {
            const data = await channelsService.getQrCode(channelId);
            applyQrFromResponse(channelId, data);
          }
        } catch (inner) {
          try {
            const data = await channelsService.getQrCode(channelId);
            applyQrFromResponse(channelId, data);
          } catch {
            throw inner;
          }
        }
      }
      startArtifactPolling(channelId);
      startPolling(channelId);
      toast.success('Escaneie o QR ou use o código de pareamento no WhatsApp.');
    } catch (err) {
      console.error(err);
      toast.error(
        err.message?.includes('503') || err.message?.includes('indisponível')
          ? 'Evolution API indisponível. Confira o Docker e EVOLUTION_API_URL no backend.'
          : err.message || 'Erro ao conectar WhatsApp.',
      );
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
      toast.error(err.message || 'Não foi possível obter o artefato de conexão.');
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
    loadChannels();
    loadAgents();

    socket.on('channel_status_update', ({ channelId, status }) => {
      setChannels((prev) =>
        prev.map((ch) => (ch.id === channelId ? { ...ch, status } : ch)),
      );
    });

    return () => {
      socket.off('channel_status_update');
      Object.values(pollingRefs.current).forEach(clearInterval);
      Object.values(artifactPollRefs.current).forEach(clearInterval);
    };
  }, []);

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
      return 'Use Conectar para iniciar a sessão WhatsApp (fluxo automático, sem acessar a Evolution).';
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
        loadingProvisionId === ch.id;
      const isConnected = st === 'connected' || st === 'open' || phase === 'connected';

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
              style={{
                ...styles.actionButton,
                ...styles.actionButtonPrimary,
              }}
              disabled={busy}
              onClick={() => {
                restorePairingOrQr(ch.id);
                connectThenQr(ch.id);
              }}
            >
              {loadingConnectId === ch.id ? 'Conectando...' : 'Conectar'}
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
    <div style={styles.page}>
      <div style={styles.content}>
        <header style={styles.header}>
          <div style={styles.titleBlock}>
            <h1 style={styles.title}>Canais</h1>
            <p style={styles.subtitle}>Centralize e administre todos os canais de atendimento do seu agente omnichannel.</p>
            {connectStepMessage ? (
              <p style={{ margin: '0.35rem 0 0', fontSize: '0.85rem', color: 'var(--accent)' }}>
                {connectStepMessage}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            style={styles.primaryButton}
            onClick={() => setShowModal(true)}
          >
            <span>➕</span>
            <span>Conectar novo canal</span>
          </button>
        </header>

        <section style={{ ...styles.card, padding: '0.9rem 1rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.6rem' }}>
            <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '0.6rem 0.7rem' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Online</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--success)' }}>{statusSummary.online}</div>
            </div>
            <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '0.6rem 0.7rem' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Instavel</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--warning)' }}>{statusSummary.unstable}</div>
            </div>
            <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '0.6rem 0.7rem' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Offline</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--danger)' }}>{statusSummary.offline}</div>
            </div>
          </div>
        </section>

        <div
          style={
            agents.length > 0
              ? styles.layoutGrid
              : styles.layoutGridSingle
          }
        >
          <section style={styles.card}>
            <div style={styles.cardHeader}>
              <div>
                <h2 style={styles.cardTitle}>Canais configurados</h2>
                <p style={styles.cardSubtitle}>
                  Acompanhe o status dos canais e acesse ações rápidas de conexão e configuração.
                </p>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <input
                  style={{ ...styles.input, maxWidth: 180 }}
                  placeholder="Buscar canal..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
                <select
                  style={{ ...styles.select, maxWidth: 140 }}
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
                  style={{ ...styles.select, maxWidth: 150 }}
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
                <div style={{ marginBottom: '0.5rem', fontWeight: 500 }}>Nenhum canal configurado ainda.</div>
                <div style={{ fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                  Crie um novo canal e conecte seus clientes pelos principais aplicativos de mensagem.
                </div>
                <button
                  type="button"
                  style={styles.primaryButton}
                  onClick={() => setShowModal(true)}
                >
                  <span>➕</span>
                  <span>Criar primeiro canal</span>
                </button>
              </div>
            ) : (
              <div style={styles.channelsList}>
                {filteredChannels.map((ch) => (
                  <div key={ch.id} style={styles.channelCard}>
                    <div style={styles.channelRowTop}>
                      <div>
                        <div style={styles.channelName}>{ch.instance || ch.name}</div>
                        <div style={styles.channelMeta}>
                          {getChannelTypeLabel(ch.type)} · Agente: {getAgentName(ch.agent_id)} · ID: {ch.id?.slice(0, 8)}
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
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                          {renderTypeActions(ch)}
                          {renderSecondaryActions(ch)}
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

          <section style={styles.card}>
            <div style={styles.cardHeader}>
              <div>
                <h2 style={styles.cardTitle}>Novo canal</h2>
                <p style={styles.cardSubtitle}>
                  Crie um novo canal vinculado a um agente para receber e enviar mensagens nos principais canais digitais.
                </p>
              </div>
            </div>

            <div style={styles.formRow}>
              <div style={styles.formRowResponsive}>
                <div style={styles.field}>
                  <label style={styles.label}>Nome do canal</label>
                  <input
                    style={styles.input}
                    placeholder="Ex.: Consultório Dra Ana Paula"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div style={styles.field}>
                  <label style={styles.label}>Tipo de canal</label>
                  <select
                    style={styles.select}
                    value={channelType}
                    onChange={(e) => {
                      setChannelType(e.target.value);
                      setWhatsappInstanceSelect('');
                      setWhatsappInstanceManual('');
                      setWhatsappAdvanced(false);
                    }}
                  >
                    <option value="whatsapp">WhatsApp</option>
                    <option value="instagram">Instagram</option>
                    <option value="telegram">Telegram</option>
                    <option value="web">Web Chat</option>
                    <option value="api">API / Webhook</option>
                  </select>
                </div>
                {channelType === 'whatsapp' && (
                  <div style={styles.field}>
                    <label style={{ ...styles.label, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <input
                        type="checkbox"
                        checked={whatsappAdvanced}
                        onChange={(e) => {
                          setWhatsappAdvanced(e.target.checked);
                          setWhatsappInstanceSelect('');
                          setWhatsappInstanceManual('');
                        }}
                      />
                      Modo avançado: vincular instância Evolution já existente
                    </label>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.35rem 0 0' }}>
                      Fluxo normal: criamos a instância automaticamente. Avançado só para integrações que exijam nome manual.
                    </p>
                  </div>
                )}
                {channelType === 'whatsapp' && whatsappAdvanced && (
                  <>
                    <div style={styles.field}>
                      <label style={styles.label}>Instância Evolution</label>
                      <select
                        style={styles.select}
                        value={whatsappInstanceSelect}
                        onChange={(e) => setWhatsappInstanceSelect(e.target.value)}
                      >
                        <option value="">Selecione uma instância existente</option>
                        {evolutionInstanceNames.map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div style={styles.field}>
                      <label style={styles.label}>Ou nome exato da instância</label>
                      <input
                        style={styles.input}
                        placeholder="Se não estiver na lista acima"
                        value={whatsappInstanceManual}
                        onChange={(e) => setWhatsappInstanceManual(e.target.value)}
                      />
                    </div>
                  </>
                )}
                <div style={styles.field}>
                  <label style={styles.label}>Agente</label>
                  <select
                    style={styles.select}
                    value={agentId}
                    onChange={(e) => setAgentId(e.target.value)}
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

              <div style={styles.formActions}>
                <button
                  type="button"
                  style={styles.buttonSecondary}
                  onClick={() => {
                    setName('');
                    setAgentId('');
                    setWhatsappInstanceSelect('');
                    setWhatsappInstanceManual('');
                    setWhatsappAdvanced(false);
                  }}
                >
                  Limpar
                </button>
                <button
                  type="button"
                  style={styles.buttonPrimary}
                  disabled={loadingCreate}
                  onClick={createChannel}
                >
                  {loadingCreate ? 'Criando...' : 'Criar canal'}
                </button>
              </div>
            </div>
          </section>
        </div>

        {showModal && (
          <div
            style={styles.modalOverlay}
            onClick={() => setShowModal(false)}
          >
            <div
              style={styles.modalCard}
              onClick={(e) => e.stopPropagation()}
            >
              <h2 style={styles.modalTitle}>Novo Canal</h2>
              <div style={styles.formRow}>
                <div style={styles.field}>
                  <label style={styles.label}>Nome do canal</label>
                  <input
                    style={styles.input}
                    placeholder="Ex.: Consultório Dra Ana Paula"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div style={styles.field}>
                  <label style={styles.label}>Tipo de canal</label>
                  <select
                    style={styles.select}
                    value={channelType}
                    onChange={(e) => {
                      setChannelType(e.target.value);
                      setWhatsappInstanceSelect('');
                      setWhatsappInstanceManual('');
                      setWhatsappAdvanced(false);
                    }}
                  >
                    <option value="whatsapp">WhatsApp</option>
                    <option value="instagram">Instagram</option>
                    <option value="telegram">Telegram</option>
                    <option value="web">Web Chat</option>
                    <option value="api">API / Webhook</option>
                  </select>
                </div>
                {channelType === 'whatsapp' && (
                  <div style={styles.field}>
                    <label style={{ ...styles.label, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <input
                        type="checkbox"
                        checked={whatsappAdvanced}
                        onChange={(e) => {
                          setWhatsappAdvanced(e.target.checked);
                          setWhatsappInstanceSelect('');
                          setWhatsappInstanceManual('');
                        }}
                      />
                      Modo avançado: instância Evolution manual
                    </label>
                  </div>
                )}
                {channelType === 'whatsapp' && whatsappAdvanced && (
                  <>
                    <div style={styles.field}>
                      <label style={styles.label}>Instância Evolution</label>
                      <select
                        style={styles.select}
                        value={whatsappInstanceSelect}
                        onChange={(e) => setWhatsappInstanceSelect(e.target.value)}
                      >
                        <option value="">Selecione uma instância existente</option>
                        {evolutionInstanceNames.map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div style={styles.field}>
                      <label style={styles.label}>Ou nome exato</label>
                      <input
                        style={styles.input}
                        placeholder="Instância criada na API"
                        value={whatsappInstanceManual}
                        onChange={(e) => setWhatsappInstanceManual(e.target.value)}
                      />
                    </div>
                  </>
                )}
                <div style={styles.field}>
                  <label style={styles.label}>Agente</label>
                  <select
                    style={styles.select}
                    value={agentId}
                    onChange={(e) => setAgentId(e.target.value)}
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
                  onClick={() => {
                    setShowModal(false);
                    setWhatsappInstanceSelect('');
                    setWhatsappInstanceManual('');
                    setWhatsappAdvanced(false);
                  }}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  style={styles.buttonPrimary}
                  disabled={loadingCreate}
                  onClick={createChannel}
                >
                  {loadingCreate ? 'Criando...' : 'Criar canal'}
                </button>
              </div>
            </div>
          </div>
        )}

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
                <button
                  type="button"
                  style={styles.buttonPrimary}
                  onClick={() => setQrCode(null)}
                >
                  Fechar
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
