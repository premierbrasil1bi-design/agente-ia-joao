import { useEffect, useRef, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import { socket } from '../lib/socket.js';
import { agentApi } from '../services/agentApi.js';
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
  const [qrCode, setQrCode] = useState(null);
  const [loadingCreate, setLoadingCreate] = useState(false);
  const [loadingQr, setLoadingQr] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const pollingRefs = useRef({});

  async function loadChannels() {
    const data = await agentApi.request('/api/agent/channels');
    setChannels(Array.isArray(data) ? data : []);
  }

  async function loadAgents() {
    const data = await agentApi.request('/api/agent/agents');
    setAgents(Array.isArray(data) ? data : []);
  }

  async function createChannel() {
    if (!name || !agentId) {
      toast.error('Preencha todos os campos');
      return;
    }

    setLoadingCreate(true);
    try {
      const data = await agentApi.request('/api/channels', {
        method: 'POST',
        body: { name, agentId, type: channelType },
      });

      toast.success('Canal criado com sucesso');

      setShowModal(false);
      setName('');
      setAgentId('');
      setChannelType('whatsapp');

      await loadChannels();

      if (data?.channel?.id) {
        startPolling(data.channel.id);
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

  async function getQr(channelId) {
    setLoadingQr(channelId);
    try {
      const data = await agentApi.request(`/api/channels/${channelId}/qrcode`, { method: 'GET' });

      if (!data?.qrcode) {
        throw new Error('QR não disponível');
      }

      const raw = typeof data.qrcode === 'string' ? data.qrcode : data.qrcode?.base64 ?? data.qrcode?.code ?? '';
      const qr = raw.startsWith('data:image') ? raw : `data:image/png;base64,${raw}`;

      sessionStorage.setItem(`qr_${channelId}`, qr);
      setQrCode(qr);

      startPolling(channelId);
    } catch (err) {
      console.error(err);
      toast.error('Erro na conexão com WhatsApp');
    } finally {
      setLoadingQr(null);
    }
  }

  const startPolling = useCallback((channelId) => {
    if (pollingRefs.current[channelId]) return;

    pollingRefs.current[channelId] = setInterval(async () => {
      try {
        const data = await agentApi.request(`/api/channels/${channelId}/status`, { method: 'GET' });

        setChannels((prev) =>
          prev.map((ch) => (ch.id === channelId ? { ...ch, status: data.status } : ch)),
        );

        if (['connected', 'disconnected'].includes(data.status)) {
          clearInterval(pollingRefs.current[channelId]);
          delete pollingRefs.current[channelId];
        }
      } catch {
        // silencioso
      }
    }, 5000);
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
      if (s === 'connected') {
        return 'Canal WhatsApp conectado. Mensagens serão roteadas automaticamente para o agente vinculado.';
      }
      if (s === 'connecting') {
        return 'Escaneie o QR Code no WhatsApp para finalizar a conexão desta instância.';
      }
      if (s === 'created') {
        return 'Instância criada. Gere o QR Code e conecte a sessão do WhatsApp.';
      }
      if (s === 'error') {
        return 'Houve um erro na conexão com a Evolution. Verifique as credenciais e a instância.';
      }
      return 'Configure a instância na Evolution e conecte o WhatsApp para iniciar o atendimento.';
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
      return (
        <>
          {ch.status === 'created' && (
            <button
              type="button"
              style={{
                ...styles.actionButton,
                ...styles.actionButtonPrimary,
              }}
              disabled={loadingQr === ch.id || loadingCreate}
              onClick={() => {
                restoreQr(ch.id);
                getQr(ch.id);
              }}
            >
              {loadingQr === ch.id ? 'Gerando...' : 'Conectar WhatsApp'}
            </button>
          )}
          {ch.status === 'connecting' && (
            <button
              type="button"
              style={{
                ...styles.actionButton,
                ...styles.actionButtonPrimary,
              }}
              disabled={loadingQr === ch.id || loadingCreate}
              onClick={() => {
                restoreQr(ch.id);
                getQr(ch.id);
              }}
            >
              {loadingQr === ch.id ? 'Atualizando...' : 'Reexibir QR Code'}
            </button>
          )}
          {!ch.status && (
            <button
              type="button"
              style={styles.actionButton}
              disabled={loadingQr === ch.id || loadingCreate}
              onClick={() => {
                restoreQr(ch.id);
                getQr(ch.id);
              }}
            >
              {loadingQr === ch.id ? 'Gerando...' : 'QR Code'}
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
        onClick={() =>
          toast('Edição de canal ainda não configurada nesta interface.')
        }
      >
        Editar
      </button>
      <button
        type="button"
        style={{
          ...styles.actionButton,
          ...styles.actionButtonMuted,
        }}
        onClick={() =>
          toast('Ativação/Desativação de canal será configurada em breve.')
        }
      >
        Desativar
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
      onClick={() =>
        toast('Exclusão de canal deve ser confirmada em fluxo dedicado.')
      }
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

  return (
    <div style={styles.page}>
      <div style={styles.content}>
        <header style={styles.header}>
          <div style={styles.titleBlock}>
            <h1 style={styles.title}>Canais</h1>
            <p style={styles.subtitle}>Centralize e administre todos os canais de atendimento do seu agente omnichannel.</p>
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
                    onChange={(e) => setChannelType(e.target.value)}
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
                    onChange={(e) => setChannelType(e.target.value)}
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
                  onClick={() => setShowModal(false)}
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
      </div>
    </div>
  );
}
