/**
 * Página "Contexto do Agente" – exibe dados de GET /api/context e header x-channel-active.
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useChannel } from '../context/ChannelContext';
import { useAgentAuth } from '../context/AgentAuthContext';
import { createApiClient } from '../api/client';

const styles = {
  section: {
    marginBottom: '1.5rem',
  },
  label: {
    fontSize: '0.75rem',
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: 4,
  },
  value: {
    fontSize: '1rem',
    fontWeight: 600,
    fontFamily: 'monospace',
  },
  card: {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '1rem 1.25rem',
    marginBottom: '1rem',
  },
  header: {
    borderLeft: '4px solid var(--accent)',
    paddingLeft: '0.75rem',
    marginBottom: '1rem',
  },
};

export function ContextoAgente() {
  const { channel } = useChannel();
  const { getToken, logout } = useAgentAuth();
  const navigate = useNavigate();
  const [ctx, setCtx] = useState(null);
  const [error, setError] = useState(null);

  const onUnauthorized = useCallback(() => {
    logout();
    navigate('/login', { replace: true });
  }, [logout, navigate]);

  useEffect(() => {
    let cancelled = false;
    const api = createApiClient(() => channel, getToken, onUnauthorized);
    api
      .getContext(null, null)
      .then((data) => {
        if (!cancelled) setCtx(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => { cancelled = true; };
  }, [channel, getToken, onUnauthorized]);

  if (error) {
    return (
      <div style={{ color: 'var(--danger)', padding: '1rem' }}>
        Erro ao carregar contexto: {error}
      </div>
    );
  }

  if (!ctx) {
    return <p style={{ color: 'var(--text-muted)' }}>Carregando contexto...</p>;
  }

  const headerActive = ctx._headerXChannelActive ?? ctx['x-channel-active'] ?? ctx.channel ?? '—';

  return (
    <>
      <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
        Dados retornados por <code>GET /api/context</code> (canal vem do middleware). Funciona com dados simulados se Neon não estiver conectado.
      </p>

      <div style={styles.card}>
        <div style={styles.header}>
          <div style={styles.label}>Header de resposta</div>
          <div style={styles.value}>x-channel-active: {headerActive}</div>
        </div>
      </div>

      <div style={styles.card}>
        <div style={styles.section}>
          <div style={styles.label}>client_id</div>
          <div style={styles.value}>{ctx.client_id ?? '—'}</div>
        </div>
        <div style={styles.section}>
          <div style={styles.label}>agent_id</div>
          <div style={styles.value}>{ctx.agent_id ?? '—'}</div>
        </div>
        <div style={styles.section}>
          <div style={styles.label}>channel</div>
          <div style={styles.value}>{ctx.channel ?? '—'}</div>
        </div>
        <div style={styles.section}>
          <div style={styles.label}>prompt_id</div>
          <div style={styles.value}>{ctx.prompt_id ?? '—'}</div>
        </div>
        <div style={styles.section}>
          <div style={styles.label}>canal_nome</div>
          <div style={styles.value}>{ctx.canal_nome ?? '—'}</div>
        </div>
      </div>
    </>
  );
}
