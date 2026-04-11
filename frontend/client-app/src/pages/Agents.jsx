/**
 * Agents page – full CRUD for tenant-scoped agents (Client App).
 * GET/POST/PUT/DELETE /api/agents; JWT scopes by tenantId.
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAgentAuth } from '../context/AgentAuthContext';
import { createAgentsApi } from '../api/agents';
import { useTenantLimitsContext } from '../context/TenantLimitsContext.jsx';
import { UpgradePlanModal } from '../components/tenant/UpgradePlanModal.jsx';
import { isTenantPlanLimitError, tenantPlanLimitReasonFromError } from '../utils/mapTenantLimitReason.js';
import { TenantPlanBadge } from '../components/tenant/TenantPlanBadge.jsx';

const DEFAULT_MODEL = 'gpt-4o-mini';

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

function StatusBadge({ agent }) {
  const active = agent.active !== undefined ? agent.active : (agent.status || '').toLowerCase() === 'ativo';
  const style = active ? { ...styles.badge, ...styles.badgeAtivo } : { ...styles.badge, ...styles.badgeInativo };
  return <span style={style}>{active ? 'Ativo' : 'Inativo'}</span>;
}

const emptyForm = () => ({
  name: '',
  slug: '',
  prompt: '',
  model: DEFAULT_MODEL,
  temperature: 0.7,
  max_tokens: 2048,
  active: true,
});

export function Agents() {
  const { getToken, logout } = useAgentAuth();
  const navigate = useNavigate();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [modal, setModal] = useState(null);
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const { plan, limits, usage, features, refresh, loading: limitsLoading } = useTenantLimitsContext();
  const [planLimitModal, setPlanLimitModal] = useState({ open: false, reason: null });

  const atAgentLimit =
    limits?.maxAgents != null &&
    Number(limits.maxAgents) > 0 &&
    Number(usage?.agents ?? 0) >= Number(limits.maxAgents);
  const canCreateAgents =
    features?.can_create_agents != null
      ? Boolean(features.can_create_agents)
      : !atAgentLimit;

  const onUnauthorized = useCallback(() => {
    logout();
    navigate('/login', { replace: true });
  }, [logout, navigate]);

  const api = useCallback(
    () => createAgentsApi(getToken, onUnauthorized),
    [getToken, onUnauthorized]
  );

  const fetchAgents = useCallback(() => {
    setLoading(true);
    setError(null);
    api()
      .getAgents()
      .then((data) => setList(Array.isArray(data) ? data : []))
      .catch((err) => {
        setList([]);
        setError(err.message || 'Não foi possível carregar os agentes.');
      })
      .finally(() => setLoading(false));
  }, [api]);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const openCreate = useCallback(() => {
    setFormError(null);
    setModal({ mode: 'create', ...emptyForm() });
  }, []);

  const openEdit = useCallback(
    (agent) => {
      setFormError(null);
      setModal({
        mode: 'edit',
        id: agent.id,
        name: agent.name ?? '',
        slug: agent.slug ?? '',
        prompt: agent.prompt ?? '',
        model: agent.model ?? DEFAULT_MODEL,
        temperature: Number(agent.temperature) ?? 0.7,
        max_tokens: Number(agent.max_tokens) ?? 2048,
        active: agent.active !== undefined ? agent.active : (agent.status || '').toLowerCase() === 'ativo',
      });
    },
    []
  );

  const closeModal = useCallback(() => {
    setModal(null);
    setFormError(null);
  }, []);

  const buildPayload = useCallback((m) => ({
    name: (m.name || '').trim(),
    slug: (m.slug || '').trim() || undefined,
    prompt: (m.prompt || '').trim() || undefined,
    model: m.model || DEFAULT_MODEL,
    temperature: Number(m.temperature) ?? 0.7,
    max_tokens: Number(m.max_tokens) ?? 2048,
    active: Boolean(m.active),
  }), []);

  const handleCreate = useCallback(
    (e) => {
      e.preventDefault();
      if (!modal || modal.mode !== 'create') return;
      const name = (modal.name || '').trim();
      if (!name) {
        setFormError('Informe o nome do agente.');
        return;
      }
      setFormError(null);
      setSaving(true);
      api()
        .createAgent(buildPayload(modal))
        .then(() => {
          closeModal();
          fetchAgents();
          refresh();
          setToast('Agente criado.');
        })
        .catch((err) => {
          if (isTenantPlanLimitError(err)) {
            setPlanLimitModal({ open: true, reason: tenantPlanLimitReasonFromError(err) });
            refresh();
            return;
          }
          setFormError(err.message || 'Não foi possível criar o agente.');
        })
        .finally(() => setSaving(false));
    },
    [modal, api, closeModal, fetchAgents, buildPayload, refresh]
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
      api()
        .updateAgent(modal.id, buildPayload(modal))
        .then(() => {
          closeModal();
          fetchAgents();
          setToast('Agente atualizado.');
        })
        .catch((err) => setFormError(err.message || 'Não foi possível atualizar o agente.'))
        .finally(() => setSaving(false));
    },
    [modal, api, closeModal, fetchAgents, buildPayload]
  );

  const handleToggleActive = useCallback(
    (agent) => {
      const nextActive = agent.active !== undefined ? !agent.active : (agent.status || '').toLowerCase() !== 'ativo';
      api()
        .updateAgent(agent.id, { ...agent, active: nextActive })
        .then(() => {
          fetchAgents();
          setToast(nextActive ? 'Agente ativado.' : 'Agente desativado.');
        })
        .catch(() => setToast('Erro ao alterar status.'));
    },
    [api, fetchAgents]
  );

  const confirmDelete = useCallback((agent) => setDeleteTarget(agent), []);
  const cancelDelete = useCallback(() => setDeleteTarget(null), []);

  const doDelete = useCallback(() => {
    if (!deleteTarget) return;
    setDeleting(true);
    api()
      .deleteAgent(deleteTarget.id)
      .then(() => {
        setDeleteTarget(null);
        fetchAgents();
        refresh();
        setToast('Agente excluído.');
      })
      .catch(() => setToast('Erro ao excluir agente.'))
      .finally(() => setDeleting(false));
  }, [deleteTarget, api, fetchAgents, refresh]);

  if (error) {
    return (
      <div style={{ color: 'var(--danger)', padding: '1rem' }}>
        {error}
        <button type="button" style={{ ...styles.btn, marginLeft: '1rem' }} onClick={fetchAgents}>
          Tentar novamente
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div>
        <div style={styles.header}>
          <h2 style={styles.title}>Agents</h2>
        </div>
        <div style={{ width: '100%' }}>
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} style={{ ...styles.skeleton, width: i === 1 ? '40%' : i === 2 ? '30%' : '100%' }} />
          ))}
        </div>
      </div>
    );
  }

  const isActive = (agent) =>
    agent.active !== undefined ? agent.active : (agent.status || '').toLowerCase() === 'ativo';

  return (
    <>
      <div style={styles.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h2 style={styles.title}>Agents</h2>
          {!limitsLoading && plan != null ? <TenantPlanBadge plan={plan} /> : null}
        </div>
        <button
          type="button"
          style={{
            ...styles.btn,
            ...styles.btnPrimary,
            opacity: !canCreateAgents || limitsLoading ? 0.55 : 1,
            cursor: !canCreateAgents || limitsLoading ? 'not-allowed' : 'pointer',
          }}
          title={!canCreateAgents ? 'Seu plano atingiu o limite de agentes' : undefined}
          disabled={!canCreateAgents || limitsLoading}
          onClick={() => canCreateAgents && openCreate()}
        >
          Create Agent
        </button>
      </div>

      {list.length === 0 ? (
        <div style={styles.empty}>Nenhum registro encontrado</div>
      ) : (
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Name</th>
                <th style={styles.th}>Slug</th>
                <th style={styles.th}>Model</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.map((agent) => (
                <tr key={agent.id}>
                  <td style={styles.td}>{agent.name}</td>
                  <td style={styles.td}>{agent.slug ?? '—'}</td>
                  <td style={styles.td}>{agent.model ?? '—'}</td>
                  <td style={styles.td}>
                    <StatusBadge agent={agent} />
                  </td>
                  <td style={styles.td}>
                    <div style={styles.actions}>
                      <button type="button" style={styles.btn} onClick={() => openEdit(agent)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        style={isActive(agent) ? { ...styles.btn, ...styles.btnDanger } : { ...styles.btn, ...styles.btnSuccess }}
                        onClick={() => handleToggleActive(agent)}
                      >
                        {isActive(agent) ? 'Deactivate' : 'Activate'}
                      </button>
                      <button type="button" style={{ ...styles.btn, ...styles.btnDanger }} onClick={() => confirmDelete(agent)}>
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
            <h3 style={styles.modalTitle}>{modal.mode === 'create' ? 'Create Agent' : 'Edit Agent'}</h3>
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
                <label style={styles.label} htmlFor="agent-name">Name</label>
                <input
                  id="agent-name"
                  style={styles.input}
                  value={modal.name}
                  onChange={(e) => setModal((m) => ({ ...m, name: e.target.value }))}
                  placeholder="Agent name"
                  required
                />
              </div>
              <div style={styles.field}>
                <label style={styles.label} htmlFor="agent-slug">Slug</label>
                <input
                  id="agent-slug"
                  style={styles.input}
                  value={modal.slug}
                  onChange={(e) => setModal((m) => ({ ...m, slug: e.target.value }))}
                  placeholder="agent-slug"
                />
              </div>
              <div style={styles.field}>
                <label style={styles.label} htmlFor="agent-prompt">Prompt</label>
                <textarea
                  id="agent-prompt"
                  style={{ ...styles.input, minHeight: 80 }}
                  value={modal.prompt}
                  onChange={(e) => setModal((m) => ({ ...m, prompt: e.target.value }))}
                  placeholder="System prompt"
                />
              </div>
              <div style={styles.field}>
                <label style={styles.label} htmlFor="agent-model">Model</label>
                <select
                  id="agent-model"
                  style={styles.select}
                  value={modal.model}
                  onChange={(e) => setModal((m) => ({ ...m, model: e.target.value }))}
                >
                  <option value="gpt-4o-mini">gpt-4o-mini</option>
                  <option value="gpt-4o">gpt-4o</option>
                  <option value="gpt-4-turbo">gpt-4-turbo</option>
                </select>
              </div>
              <div style={styles.field}>
                <label style={styles.label} htmlFor="agent-temperature">Temperature</label>
                <input
                  id="agent-temperature"
                  type="number"
                  min={0}
                  max={2}
                  step={0.1}
                  style={styles.input}
                  value={modal.temperature}
                  onChange={(e) => setModal((m) => ({ ...m, temperature: parseFloat(e.target.value) || 0.7 }))}
                />
              </div>
              <div style={styles.field}>
                <label style={styles.label} htmlFor="agent-max-tokens">Max Tokens</label>
                <input
                  id="agent-max-tokens"
                  type="number"
                  min={1}
                  max={128000}
                  style={styles.input}
                  value={modal.max_tokens}
                  onChange={(e) => setModal((m) => ({ ...m, max_tokens: parseInt(e.target.value, 10) || 2048 }))}
                />
              </div>
              <div style={{ ...styles.field, ...styles.checkboxRow }}>
                <input
                  id="agent-active"
                  type="checkbox"
                  checked={modal.active}
                  onChange={(e) => setModal((m) => ({ ...m, active: e.target.checked }))}
                />
                <label style={{ ...styles.label, marginBottom: 0 }} htmlFor="agent-active">Active</label>
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
              Excluir o agente &quot;{deleteTarget.name}&quot;? Esta ação não pode ser desfeita.
            </p>
            <div style={styles.modalActions}>
              <button type="button" style={styles.btn} onClick={cancelDelete}>
                Cancel
              </button>
              <button type="button" style={{ ...styles.btn, ...styles.btnDanger }} onClick={doDelete} disabled={deleting}>
                {deleting ? 'Excluindo...' : 'Excluir'}
              </button>
            </div>
          </div>
        </div>
      )}

      <UpgradePlanModal
        open={planLimitModal.open}
        onClose={() => setPlanLimitModal({ open: false, reason: null })}
        reason={planLimitModal.reason}
        plan={plan}
        blockedFeature="Agentes"
        onViewPlan={() => {
          setPlanLimitModal({ open: false, reason: null });
          navigate('/dashboard');
        }}
      />

      {toast && (
        <div style={{ ...styles.toast, ...styles.toastSuccess }} role="status">
          {toast}
        </div>
      )}
    </>
  );
}
