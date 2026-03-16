/**
 * Channels page – Painel do Agente (client-app).
 * Inclui botões de integração WhatsApp (Connect, QR Code, Status, Disconnect) quando type === "whatsapp".
 * Usa agentApi.request, que lê agent_token do localStorage e envia Authorization: Bearer <agent_token>.
 */

import { useCallback, useEffect, useState } from 'react';
import { QRCodeModal } from '../components/QRCodeModal.jsx';
import { agentApi } from '../services/agentApi.js';

const styles = {
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '1.5rem',
    flexWrap: 'wrap',
    gap: '1rem',
  },
  title: { margin: 0, fontSize: '1.5rem', fontWeight: 600, color: 'var(--text)' },
  btn: {
    padding: '0.5rem 1rem',
    borderRadius: 6,
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    color: 'var(--text)',
    cursor: 'pointer',
    fontSize: '0.9rem',
  },
  btnPrimary: { background: 'var(--accent)', borderColor: 'var(--accent)', color: '#fff' },
  btnDanger: { color: 'var(--danger)', borderColor: 'var(--danger)' },
  btnSuccess: { color: 'var(--success)', borderColor: 'var(--success)' },
  tableWrap: {
    overflowX: 'auto',
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--surface)',
  },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: {
    textAlign: 'left',
    padding: '0.75rem 1rem',
    borderBottom: '1px solid var(--border)',
    fontSize: '0.8rem',
    color: 'var(--text-muted)',
    fontWeight: 600,
  },
  td: { padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)', fontSize: '0.9rem', color: 'var(--text)' },
  badge: {
    display: 'inline-block',
    padding: '0.2rem 0.5rem',
    borderRadius: 4,
    fontSize: '0.75rem',
    fontWeight: 500,
  },
  badgeAtivo: { background: 'rgba(63,185,80,0.2)', color: 'var(--success)' },
  badgeInativo: { background: 'rgba(139,148,158,0.2)', color: 'var(--text-muted)' },
  actions: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap' },
  empty: {
    padding: '2rem',
    textAlign: 'center',
    color: 'var(--text-muted)',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 8,
  },
  toast: {
    position: 'fixed',
    bottom: 24,
    right: 24,
    padding: '0.75rem 1.25rem',
    borderRadius: 8,
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
    zIndex: 200,
    fontSize: '0.9rem',
    color: 'var(--text)',
    borderLeft: '4px solid var(--success)',
  },
};

function StatusBadge({ channel }) {
  const active = channel.active !== undefined ? channel.active : (channel.is_active !== false);
  const style = active ? { ...styles.badge, ...styles.badgeAtivo } : { ...styles.badge, ...styles.badgeInativo };
  return <span style={style}>{active ? 'Active' : 'Inactive'}</span>;
}

export function Channels() {
  const [list, setList] = useState([]);
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [showQrModal, setShowQrModal] = useState(false);
  const [qrCode, setQrCode] = useState('');

  const fetchChannels = useCallback(() => {
    setLoading(true);
    setError(null);
    agentApi
      .request('/api/agent/channels')
      .then((data) => setList(Array.isArray(data) ? data : []))
      .catch((err) => {
        setList([]);
        setError(err.message || 'Não foi possível carregar os canais.');
      })
      .finally(() => setLoading(false));
  }, []);

  const fetchAgents = useCallback(() => {
    agentApi
      .request('/api/agent/agents')
      .then((data) => setAgents(Array.isArray(data) ? data : []))
      .catch(() => setAgents([]));
  }, []);

  useEffect(() => {
    fetchChannels();
    fetchAgents();
  }, [fetchChannels, fetchAgents]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const handleConnect = useCallback(async (channelId) => {
    try {
      await agentApi.request(`/api/channels/${channelId}/connect`, { method: 'POST' });
      setToast('Instância solicitada.');
      fetchChannels();
    } catch (err) {
      console.error(err);
      setToast(err.message || 'Erro ao conectar.');
    }
  }, [fetchChannels]);

  const handleQrCode = useCallback(async (channelId) => {
    try {
      const data = await agentApi.request(`/api/channels/${channelId}/qrcode`, { method: 'GET' });
      const qr = typeof data.qrcode === 'string' ? data.qrcode : (data.qrcode?.base64 ?? data.qrcode?.code ?? '');
      if (qr) {
        const dataUrl = qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`;
        setQrCode(dataUrl);
        setShowQrModal(true);
      } else {
        setToast('QR Code não disponível. Clique em Connect antes.');
      }
    } catch (err) {
      console.error(err);
      setToast(err.message || 'Erro ao carregar QR Code.');
    }
  }, []);

  const handleStatus = useCallback(async (channelId) => {
    try {
      const data = await agentApi.request(`/api/channels/${channelId}/status`, { method: 'GET' });
      const status = data.status ?? data?.channel?.status ?? data?.instance?.state ?? null;
      const label = status === 'open' ? 'Connected' : status === 'close' ? 'Disconnected' : status === 'connecting' ? 'Connecting' : String(status || '—');
      setToast(`Status: ${label}`);
      fetchChannels();
    } catch (err) {
      console.error(err);
      setToast(err.message || 'Erro ao verificar status.');
    }
  }, [fetchChannels]);

  const handleDisconnect = useCallback(async (channelId) => {
    try {
      await agentApi.request(`/api/channels/${channelId}/disconnect`, { method: 'POST' });
      setToast('Instância desconectada.');
      fetchChannels();
    } catch (err) {
      console.error(err);
      setToast(err.message || 'Erro ao desconectar.');
    }
  }, [fetchChannels]);

  const agentMap = Object.fromEntries((agents || []).map((a) => [a.id, a]));
  const getAgentName = (agentId) => agentMap[agentId]?.name ?? agentId?.slice(0, 8) ?? '—';

  const isChannelActive = (ch) => ch.active !== undefined ? ch.active : ch.is_active !== false;

  if (error) {
    return (
      <div style={{ color: 'var(--danger)', padding: '1rem' }}>
        {error}
        <button type="button" style={{ ...styles.btn, marginLeft: '1rem' }} onClick={fetchChannels}>
          Tentar novamente
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div>
        <div style={styles.header}>
          <h2 style={styles.title}>Channels</h2>
        </div>
        <div style={{ padding: '1rem' }}>Carregando...</div>
      </div>
    );
  }

  return (
    <>
      <div style={styles.header}>
        <h2 style={styles.title}>Channels</h2>
      </div>

      {list.length === 0 ? (
        <div style={styles.empty}>Nenhum registro encontrado</div>
      ) : (
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Type</th>
                <th style={styles.th}>Instance</th>
                <th style={styles.th}>Agent</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.map((ch) => (
                <tr key={ch.id}>
                  <td style={styles.td}>{ch.type ?? '—'}</td>
                  <td style={styles.td}>{ch.instance ?? ch.name ?? '—'}</td>
                  <td style={styles.td}>{getAgentName(ch.agent_id)}</td>
                  <td style={styles.td}>
                    <StatusBadge channel={ch} />
                  </td>
                  <td style={styles.td}>
                    <div style={styles.actions}>
                      <button type="button" style={styles.btn}>
                        Edit
                      </button>
                      <button
                        type="button"
                        style={isChannelActive(ch) ? { ...styles.btn, ...styles.btnDanger } : { ...styles.btn, ...styles.btnSuccess }}
                      >
                        {isChannelActive(ch) ? 'Deactivate' : 'Activate'}
                      </button>
                      <button type="button" style={{ ...styles.btn, ...styles.btnDanger }}>
                        Delete
                      </button>
                      {(ch.type || '').toLowerCase() === 'whatsapp' && (
                        <>
                          <button type="button" style={styles.btn} onClick={() => handleConnect(ch.id)}>
                            Connect
                          </button>
                          <button type="button" style={styles.btn} onClick={() => handleQrCode(ch.id)}>
                            QR Code
                          </button>
                          <button type="button" style={styles.btn} onClick={() => handleStatus(ch.id)}>
                            Status
                          </button>
                          <button type="button" style={styles.btn} onClick={() => handleDisconnect(ch.id)}>
                            Disconnect
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <QRCodeModal
        open={showQrModal}
        qrCode={qrCode}
        onClose={() => {
          setShowQrModal(false);
          setQrCode('');
        }}
      />

      {toast && (
        <div style={styles.toast} role="status">
          {toast}
        </div>
      )}
    </>
  );
}
