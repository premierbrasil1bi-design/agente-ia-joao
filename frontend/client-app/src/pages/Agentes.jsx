/**
 * Página Agentes – CRUD completo no painel Admin.
 * Listagem, criar, editar e ativar/desativar agentes.
 * Estados: loading, vazio, erro (mensagem amigável).
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAgentAuth } from '../context/AgentAuthContext';
import { createApiClient } from '../api/client';

const styles = {
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '1.5rem',
    flexWrap: 'wrap',
    gap: '1rem',
  },
  title: { margin: 0, fontSize: '1.5rem', fontWeight: 600 },
  btn: {
    padding: '0.5rem 1rem',
    borderRadius: 6,
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    color: 'var(--text)',
    cursor: 'pointer',
    fontSize: '0.9rem',
  },
  btnPrimary: {
    background: 'var(--accent)',
    borderColor: 'var(--accent)',
    color: '#fff',
  },
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
  td: { padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)', fontSize: '0.9rem' },
  badge: {
    display: 'inline-block',
    padding: '0.2rem 0.5rem',
    borderRadius: 4,
    fontSize: '0.75rem',
    fontWeight: 500,
  },
  badgeAtivo: { background: 'rgba(63,185,80,0.2)', color: 'var(--success)' },
  badgeInativo: { background: 'rgba(139,148,158,0.2)', color: 'var(--text-muted)' },
  badgeErro: { background: 'rgba(248,81,73,0.2)', color: 'var(--danger)' },
  actions: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap' },
  empty: {
    padding: '2rem',
    textAlign: 'center',
    color: 'var(--text-muted)',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 8,
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
  },
  modalTitle: { margin: '0 0 1rem', fontSize: '1.1rem' },
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
  modalActions: { display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' },
  errorMsg: { color: 'var(--danger)', fontSize: '0.85rem', marginTop: 4 },
};

function StatusBadge({ status }) {
  const s = (status || '').toLowerCase();
  const style =
    s === 'ativo'
      ? { ...styles.badge, ...styles.badgeAtivo }
      : s === 'erro'
        ? { ...styles.badge, ...styles.badgeErro }
        : { ...styles.badge, ...styles.badgeInativo };
  const label = s === 'ativo' ? 'Ativo' : s === 'erro' ? 'Erro' : 'Inativo';
  return <span style={style}>{label}</span>;
}

export function Agentes() {
  const { getToken, logout } = useAgentAuth();
  const navigate = useNavigate();
  const [agents, setAgents] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modal, setModal] = useState(null);
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState(null);

  const onUnauthorized = useCallback(() => {
    logout();
    navigate('/login', { replace: true });
  }, [logout, navigate]);

  const fetchData = useCallback(() => {
    const api = createApiClient('web', getToken, onUnauthorized);
    setLoading(true);
    setError(null);
    Promise.all([api.listAgents(), api.getClients()])
      .then(([agentsList, clientsList]) => {
        setAgents(Array.isArray(agentsList) ? agentsList : []);
        setClients(Array.isArray(clientsList) ? clientsList : []);
      })
      .catch((err) => {
        setAgents([]);
        setClients([]);
        setError(err.message || 'Não foi possível carregar os agentes.');
      })
      .finally(() => setLoading(false));
  }, [getToken, onUnauthorized]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const openCreate = useCallback(() => {
    setActionError(null);
    setModal({
      mode: 'create',
      client_id: clients[0]?.id || '',
      name: '',
      slug: '',
    });
    setFormError(null);
  }, [clients]);

  const openEdit = useCallback((agent) => {
    setActionError(null);
    setModal({
      mode: 'edit',
      id: agent.id,
      name: agent.name || '',
      slug: agent.slug || '',
      status: (agent.status || 'ativo').toLowerCase(),
    });
    setFormError(null);
  }, []);

  const closeModal = useCallback(() => {
    setModal(null);
    setFormError(null);
  }, []);

  const handleCreate = useCallback(
    (e) => {
      e.preventDefault();
      if (!modal || modal.mode !== 'create') return;
      const name = (modal.name || '').trim();
      const client_id = (modal.client_id || '').trim();
      if (!name) {
        setFormError('Informe o nome do agente.');
        return;
      }
      if (!client_id) {
        setFormError('Selecione um cliente.');
        return;
      }
      setFormError(null);
      setSaving(true);
      const api = createApiClient('web', getToken, onUnauthorized);
      api
        .createAgent({
          client_id,
          name,
          slug: modal.slug?.trim() || undefined,
          channel: 'web',
        })
        .then(() => {
          closeModal();
          fetchData();
        })
        .catch((err) => {
          setFormError(err.message || 'Não foi possível criar o agente.');
        })
        .finally(() => setSaving(false));
    },
    [modal, getToken, onUnauthorized, closeModal, fetchData]
  );

  const handleEdit = useCallback(
    (e) => {
      e.preventDefault();
      if (!modal || modal.mode !== 'edit' || !modal.id) return;
      const name = (modal.name || '').trim();
      if (!name) {
        setFormError('Informe o nome do agente.');
        return;
      }
      setFormError(null);
      setSaving(true);
      const api = createApiClient('web', getToken, onUnauthorized);
      api
        .updateAgent(modal.id, {
          name,
          slug: modal.slug?.trim() || undefined,
          status: modal.status,
        })
        .then(() => {
          closeModal();
          fetchData();
        })
        .catch((err) => {
          setFormError(err.message || 'Não foi possível atualizar o agente.');
        })
        .finally(() => setSaving(false));
    },
    [modal, getToken, onUnauthorized, closeModal, fetchData]
  );

  const handleDesativar = useCallback(
    (agent) => {
      if ((agent.status || '').toLowerCase() === 'inativo') return;
      setActionError(null);
      const api = createApiClient('web', getToken, onUnauthorized);
      api
        .deleteAgent(agent.id)
        .then(() => fetchData())
        .catch(() => setActionError('Não foi possível desativar. Tente novamente.'));
    },
    [getToken, onUnauthorized, fetchData]
  );

  const handleAtivar = useCallback(
    (agent) => {
      if ((agent.status || '').toLowerCase() === 'ativo') return;
      setActionError(null);
      const api = createApiClient('web', getToken, onUnauthorized);
      api
        .updateAgent(agent.id, { status: 'ativo' })
        .then(() => fetchData())
        .catch(() => setActionError('Não foi possível ativar. Tente novamente.'));
    },
    [getToken, onUnauthorized, fetchData]
  );

  if (error) {
    return (
      <div style={{ color: 'var(--danger)', padding: '1rem' }}>
        {error}
        <button type="button" style={{ ...styles.btn, marginLeft: '1rem' }} onClick={fetchData}>
          Tentar novamente
        </button>
      </div>
    );
  }

  if (loading) {
    return <p style={{ color: 'var(--text-muted)' }}>Carregando agentes...</p>;
  }

  const clientMap = Object.fromEntries((clients || []).map((c) => [c.id, c]));

  return (
    <>
      <div style={styles.header}>
        <h2 style={styles.title}>Agentes</h2>
        <button type="button" style={{ ...styles.btn, ...styles.btnPrimary }} onClick={openCreate}>
          Novo agente
        </button>
      </div>

      {actionError && (
        <div
          style={{
            padding: '0.75rem 1rem',
            marginBottom: '1rem',
            background: 'rgba(248,81,73,0.15)',
            border: '1px solid var(--danger)',
            borderRadius: 6,
            color: 'var(--danger)',
            fontSize: '0.9rem',
          }}
        >
          {actionError}
        </div>
      )}

      {agents.length === 0 ? (
        <div style={styles.empty}>
          Nenhum agente cadastrado. Clique em &quot;Novo agente&quot; para criar o primeiro.
        </div>
      ) : (
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Nome</th>
                <th style={styles.th}>Slug</th>
                <th style={styles.th}>Cliente</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => (
                <tr key={agent.id}>
                  <td style={styles.td}>{agent.name}</td>
                  <td style={styles.td}>{agent.slug}</td>
                  <td style={styles.td}>
                    {clientMap[agent.client_id]?.name || agent.client_id?.slice(0, 8) || '—'}
                  </td>
                  <td style={styles.td}>
                    <StatusBadge status={agent.status} />
                  </td>
                  <td style={styles.td}>
                    <div style={styles.actions}>
                      <button
                        type="button"
                        style={styles.btn}
                        onClick={() => openEdit(agent)}
                      >
                        Editar
                      </button>
                      {(agent.status || '').toLowerCase() === 'ativo' ? (
                        <button
                          type="button"
                          style={{ ...styles.btn, color: 'var(--warning)' }}
                          onClick={() => handleDesativar(agent)}
                        >
                          Desativar
                        </button>
                      ) : (
                        <button
                          type="button"
                          style={{ ...styles.btn, color: 'var(--success)' }}
                          onClick={() => handleAtivar(agent)}
                        >
                          Ativar
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && modal.mode === 'create' && (
        <div style={styles.overlay} onClick={closeModal} role="presentation">
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>Novo agente</h3>
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
            <form onSubmit={handleCreate}>
              <div style={styles.field}>
                <label style={styles.label} htmlFor="create-client">
                  Cliente
                </label>
                <select
                  id="create-client"
                  style={styles.select}
                  value={modal.client_id}
                  onChange={(e) => setModal((m) => ({ ...m, client_id: e.target.value }))}
                  required
                >
                  <option value="">Selecione</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                {clients.length === 0 && (
                  <div style={{ ...styles.errorMsg, color: 'var(--text-muted)' }}>
                    Nenhum cliente cadastrado. Cadastre um cliente primeiro.
                  </div>
                )}
              </div>
              <div style={styles.field}>
                <label style={styles.label} htmlFor="create-name">
                  Nome
                </label>
                <input
                  id="create-name"
                  style={styles.input}
                  value={modal.name}
                  onChange={(e) => setModal((m) => ({ ...m, name: e.target.value }))}
                  placeholder="Ex.: Atendimento"
                  required
                />
              </div>
              <div style={styles.field}>
                <label style={styles.label} htmlFor="create-slug">
                  Slug (opcional)
                </label>
                <input
                  id="create-slug"
                  style={styles.input}
                  value={modal.slug}
                  onChange={(e) => setModal((m) => ({ ...m, slug: e.target.value }))}
                  placeholder="Ex.: atendimento"
                />
              </div>
              <div style={styles.modalActions}>
                <button type="button" style={styles.btn} onClick={closeModal}>
                  Cancelar
                </button>
                <button type="submit" style={{ ...styles.btn, ...styles.btnPrimary }} disabled={saving}>
                  {saving ? 'Salvando...' : 'Criar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {modal && modal.mode === 'edit' && (
        <div style={styles.overlay} onClick={closeModal} role="presentation">
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>Editar agente</h3>
            <form onSubmit={handleEdit}>
              <div style={styles.field}>
                <label style={styles.label} htmlFor="edit-name">
                  Nome
                </label>
                <input
                  id="edit-name"
                  style={styles.input}
                  value={modal.name}
                  onChange={(e) => setModal((m) => ({ ...m, name: e.target.value }))}
                  required
                />
              </div>
              <div style={styles.field}>
                <label style={styles.label} htmlFor="edit-slug">
                  Slug
                </label>
                <input
                  id="edit-slug"
                  style={styles.input}
                  value={modal.slug}
                  onChange={(e) => setModal((m) => ({ ...m, slug: e.target.value }))}
                />
              </div>
              <div style={styles.field}>
                <label style={styles.label} htmlFor="edit-status">
                  Status
                </label>
                <select
                  id="edit-status"
                  style={styles.select}
                  value={modal.status}
                  onChange={(e) => setModal((m) => ({ ...m, status: e.target.value }))}
                >
                  <option value="ativo">Ativo</option>
                  <option value="inativo">Inativo</option>
                  <option value="erro">Erro</option>
                </select>
              </div>
              {formError && <div style={styles.errorMsg}>{formError}</div>}
              <div style={styles.modalActions}>
                <button type="button" style={styles.btn} onClick={closeModal}>
                  Cancelar
                </button>
                <button type="submit" style={{ ...styles.btn, ...styles.btnPrimary }} disabled={saving}>
                  {saving ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
