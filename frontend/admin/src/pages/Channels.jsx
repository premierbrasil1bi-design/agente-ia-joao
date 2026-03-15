/**
 * Channels page – full CRUD for tenant-scoped channels (Client App).
 * Channels are linked to an agent. GET/POST/PUT/DELETE /api/channels.
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAgentAuth } from '../context/AgentAuthContext';
import { createChannelsApi } from '../api/channels';
import { createAgentsApi } from '../api/agents';
import { agentApi } from '../services/agentApi.js';

const CHANNEL_TYPES = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'webchat', label: 'Webchat' },
  { value: 'api', label: 'API' },
];

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
  skeleton: {
    height: 24,
    background: 'var(--border)',
    borderRadius: 4,
    marginBottom: 8,
  },
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
    padding: '1rem',
  },
  modal: {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '1.5rem',
    minWidth: 320,
    maxWidth: 480,
    maxHeight: '90vh',
    overflowY: 'auto',
  },
  modalTitle: { margin: '0 0 1rem', fontSize: '1.1rem', color: 'var(--text)' },
  field: { marginBottom: '1rem' },
  label: { display: 'block', marginBottom: 4, fontSize: '0.85rem', color: 'var(--text-muted)' },
  input: {
    width: '100%',
    padding: '0.5rem 0.75rem',
    borderRadius: 6,
    border: '1px solid var(--border)',
    background: 'var(--bg)',
    color: 'var(--text)',
    fontSize: '0.9rem',
  },
  select: {
    width: '100%',
    padding: '0.5rem 0.75rem',
    borderRadius: 6,
    border: '1px solid var(--border)',
    background: 'var(--bg)',
    color: 'var(--text)',
    fontSize: '0.9rem',
  },
  checkboxRow: { display: 'flex', alignItems: 'center', gap: 8 },
  modalActions: { display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' },
  errorMsg: { color: 'var(--danger)', fontSize: '0.85rem', marginTop: 4 },
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
  },
  toastSuccess: { borderLeft: '4px solid var(--success)' },
  confirmOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 150,
    padding: '1rem',
  },
  confirmBox: {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '1.5rem',
    maxWidth: 400,
  },
};

function StatusBadge({ channel }) {
  const active = channel.active !== undefined ? channel.active : (channel.is_active !== false);
  const style = active ? { ...styles.badge, ...styles.badgeAtivo } : { ...styles.badge, ...styles.badgeInativo };
  return <span style={style}>{active ? 'Active' : 'Inactive'}</span>;
}

const emptyForm = () => ({
  type: 'whatsapp',
  instance: '',
  agent_id: '',
  active: true,
});

export function Channels() {
  const { getToken, logout } = useAgentAuth();
  const navigate = useNavigate();
  const [list, setList] = useState([]);
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modal, setModal] = useState(null);
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [qrCode, setQrCode] = useState('');

  const onUnauthorized = useCallback(() => {
    logout();
    navigate('/login', { replace: true });
  }, [logout, navigate]);

  const channelsApi = useCallback(
    () => createChannelsApi(getToken, onUnauthorized),
    [getToken, onUnauthorized]
  );
  const agentsApi = useCallback(
    () => createAgentsApi(getToken, onUnauthorized),
    [getToken, onUnauthorized]
  );

  const fetchChannels = useCallback(() => {
    setLoading(true);
    setError(null);
    channelsApi()
      .getChannels()
      .then((data) => setList(Array.isArray(data) ? data : []))
      .catch((err) => {
        setList([]);
        setError(err.message || 'Não foi possível carregar os canais.');
      })
      .finally(() => setLoading(false));
  }, [channelsApi]);

  const fetchAgents = useCallback(() => {
    agentsApi()
      .getAgents()
      .then((data) => setAgents(Array.isArray(data) ? data : []))
      .catch(() => setAgents([]));
  }, [agentsApi]);

  useEffect(() => {
    fetchChannels();
    fetchAgents();
  }, [fetchChannels, fetchAgents]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const openCreate = useCallback(() => {
    setFormError(null);
    setModal({ mode: 'create', ...emptyForm() });
    fetchAgents();
  }, [fetchAgents]);

  const openEdit = useCallback((channel) => {
    setFormError(null);
    setModal({
      mode: 'edit',
      id: channel.id,
      type: (channel.type || 'whatsapp').toLowerCase(),
      instance: channel.instance ?? channel.name ?? '',
      agent_id: channel.agent_id ?? '',
      active: channel.active !== undefined ? channel.active : (channel.is_active !== false),
    });
  }, []);

  const closeModal = useCallback(() => {
    setModal(null);
    setFormError(null);
  }, []);

  const buildPayload = useCallback((m) => ({
    type: (m.type || 'whatsapp').toLowerCase(),
    instance: (m.instance || '').trim() || undefined,
    agent_id: (m.agent_id || '').trim() || undefined,
    active: Boolean(m.active),
  }), []);

  const handleCreate = useCallback(
    (e) => {
      e.preventDefault();
      if (!modal || modal.mode !== 'create') return;
      const agent_id = (modal.agent_id || '').trim();
      if (!agent_id) {
        setFormError('Selecione um agente.');
        return;
      }
      setFormError(null);
      setSaving(true);
      channelsApi()
        .createChannel(buildPayload(modal))
        .then(() => {
          closeModal();
          fetchChannels();
          setToast('Channel created.');
        })
        .catch((err) => setFormError(err.message || 'Não foi possível criar o canal.'))
        .finally(() => setSaving(false));
    },
    [modal, channelsApi, closeModal, fetchChannels, buildPayload]
  );

  const handleEdit = useCallback(
    (e) => {
      e.preventDefault();
      if (!modal || modal.mode !== 'edit' || !modal.id) return;
      const agent_id = (modal.agent_id || '').trim();
      if (!agent_id) {
        setFormError('Selecione um agente.');
        return;
      }
      setFormError(null);
      setSaving(true);
      channelsApi()
        .updateChannel(modal.id, buildPayload(modal))
        .then(() => {
          closeModal();
          fetchChannels();
          setToast('Channel updated.');
        })
        .catch((err) => setFormError(err.message || 'Não foi possível atualizar o canal.'))
        .finally(() => setSaving(false));
    },
    [modal, channelsApi, closeModal, fetchChannels, buildPayload]
  );

  const isChannelActive = (ch) =>
    ch.active !== undefined ? ch.active : ch.is_active !== false;

  const handleToggleActive = useCallback(
    (channel) => {
      const nextActive = !isChannelActive(channel);
      channelsApi()
        .updateChannel(channel.id, { ...channel, active: nextActive })
        .then(() => {
          fetchChannels();
          setToast(nextActive ? 'Channel activated.' : 'Channel deactivated.');
        })
        .catch(() => setToast('Error updating status.'));
    },
    [channelsApi, fetchChannels]
  );

  const confirmDelete = useCallback((channel) => setDeleteTarget(channel), []);
  const cancelDelete = useCallback(() => setDeleteTarget(null), []);

  const doDelete = useCallback(() => {
    if (!deleteTarget) return;
    setDeleting(true);
    channelsApi()
      .deleteChannel(deleteTarget.id)
      .then(() => {
        setDeleteTarget(null);
        fetchChannels();
        setToast('Channel deleted.');
      })
      .catch(() => setToast('Error deleting channel.'))
      .finally(() => setDeleting(false));
  }, [deleteTarget, channelsApi, fetchChannels]);

  const handleConnect = useCallback(async (channelId) => {
    try {
      await agentApi.request(`/api/channels/${channelId}/connect`, {
        method: 'POST',
      });
      setToast('Instance creation requested.');
      fetchChannels();
    } catch (err) {
      console.error(err);
      setToast(err.message || 'Error connecting instance.');
    }
  }, [fetchChannels]);

  const handleQrCode = useCallback(async (channelId) => {
    try {
      const data = await agentApi.request(`/api/channels/${channelId}/qrcode`, {
        method: 'GET',
      });
      if (data.qrcode) {
        setQrCode(data.qrcode);
        setShowQrModal(true);
      } else {
        setToast('QR Code not available yet.');
      }
    } catch (err) {
      console.error(err);
      setToast(err.message || 'Error loading QR Code.');
    }
  }, []);

  const handleStatus = useCallback(async (channelId) => {
    try {
      const data = await agentApi.request(`/api/channels/${channelId}/status`, {
        method: 'GET',
      });
      setToast(`Connection status: ${data.status ?? data}`);
    } catch (err) {
      console.error(err);
      setToast(err.message || 'Error checking status.');
    }
  }, []);

  const handleDisconnect = useCallback(async (channelId) => {
    try {
      await agentApi.request(`/api/channels/${channelId}/disconnect`, {
        method: 'POST',
      });
      setToast('Instance disconnected.');
      fetchChannels();
    } catch (err) {
      console.error(err);
      setToast(err.message || 'Error disconnecting.');
    }
  }, [fetchChannels]);

  const agentMap = Object.fromEntries((agents || []).map((a) => [a.id, a]));
  const getAgentName = (agentId) => agentMap[agentId]?.name ?? agentId?.slice(0, 8) ?? '—';

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
        <div style={{ width: '100%' }}>
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} style={{ ...styles.skeleton, width: i === 1 ? '30%' : i === 2 ? '25%' : '100%' }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      <div style={styles.header}>
        <h2 style={styles.title}>Channels</h2>
        <button type="button" style={{ ...styles.btn, ...styles.btnPrimary }} onClick={openCreate}>
          Create Channel
        </button>
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
                      <button type="button" style={styles.btn} onClick={() => openEdit(ch)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        style={isChannelActive(ch) ? { ...styles.btn, ...styles.btnDanger } : { ...styles.btn, ...styles.btnSuccess }}
                        onClick={() => handleToggleActive(ch)}
                      >
                        {isChannelActive(ch) ? 'Deactivate' : 'Activate'}
                      </button>
                      <button type="button" style={{ ...styles.btn, ...styles.btnDanger }} onClick={() => confirmDelete(ch)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (modal.mode === 'create' || modal.mode === 'edit') && (
        <div style={styles.overlay} onClick={closeModal} role="presentation">
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>{modal.mode === 'create' ? 'Create Channel' : 'Edit Channel'}</h3>
            {formError && (
              <div
                style={{
                  ...styles.errorMsg,
                  marginBottom: '1rem',
                  padding: '0.75rem',
                  background: 'rgba(248,81,73,0.15)',
                  border: '1px solid var(--danger)',
                  borderRadius: 6,
                }}
              >
                {formError}
              </div>
            )}
            <form onSubmit={modal.mode === 'create' ? handleCreate : handleEdit}>
              <div style={styles.field}>
                <label style={styles.label} htmlFor="channel-type">Type</label>
                <select
                  id="channel-type"
                  style={styles.select}
                  value={modal.type}
                  onChange={(e) => setModal((m) => ({ ...m, type: e.target.value }))}
                >
                  {CHANNEL_TYPES.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div style={styles.field}>
                <label style={styles.label} htmlFor="channel-instance">Instance</label>
                <input
                  id="channel-instance"
                  style={styles.input}
                  value={modal.instance}
                  onChange={(e) => setModal((m) => ({ ...m, instance: e.target.value }))}
                  placeholder="e.g. default or instance name"
                />
              </div>
              <div style={styles.field}>
                <label style={styles.label} htmlFor="channel-agent">Agent</label>
                <select
                  id="channel-agent"
                  style={styles.select}
                  value={modal.agent_id}
                  onChange={(e) => setModal((m) => ({ ...m, agent_id: e.target.value }))}
                  required
                >
                  <option value="">Select agent</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.slug ?? a.id?.slice(0, 8)})
                    </option>
                  ))}
                </select>
                {agents.length === 0 && (
                  <div style={{ ...styles.errorMsg, color: 'var(--text-muted)' }}>
                    No agents found. Create an agent first.
                  </div>
                )}
              </div>
              <div style={{ ...styles.field, ...styles.checkboxRow }}>
                <input
                  id="channel-active"
                  type="checkbox"
                  checked={modal.active}
                  onChange={(e) => setModal((m) => ({ ...m, active: e.target.checked }))}
                />
                <label style={{ ...styles.label, marginBottom: 0 }} htmlFor="channel-active">Active</label>
              </div>
              <div style={styles.modalActions}>
                <button type="button" style={styles.btn} onClick={closeModal}>
                  Cancel
                </button>
                <button type="submit" style={{ ...styles.btn, ...styles.btnPrimary }} disabled={saving}>
                  {saving ? 'Saving...' : modal.mode === 'create' ? 'Create' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div style={styles.confirmOverlay}>
          <div style={styles.confirmBox}>
            <p style={{ margin: '0 0 1rem', color: 'var(--text)' }}>
              Delete channel &quot;{deleteTarget.type} – {deleteTarget.instance || deleteTarget.name || deleteTarget.id}&quot;? This cannot be undone.
            </p>
            <div style={styles.modalActions}>
              <button type="button" style={styles.btn} onClick={cancelDelete}>
                Cancel
              </button>
              <button type="button" style={{ ...styles.btn, ...styles.btnDanger }} onClick={doDelete} disabled={deleting}>
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showQrModal && (
        <div style={styles.overlay} onClick={() => setShowQrModal(false)} role="presentation">
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>WhatsApp QR Code</h3>
            <img src={qrCode} alt="WhatsApp QR Code" style={{ width: 300, display: 'block', margin: '0 auto' }} />
            <div style={{ ...styles.modalActions, marginTop: '1rem' }}>
              <button type="button" style={styles.btn} onClick={() => setShowQrModal(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div style={{ ...styles.toast, ...styles.toastSuccess }} role="status">
          {toast}
        </div>
      )}
    </>
  );
}
