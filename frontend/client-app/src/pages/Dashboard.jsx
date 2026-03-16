/**
 * Dashboard AGENTE IA OMNICANAL – GET /api/agent/dashboard/summary.
 * Se agent_token não existir → redirect /login. Caso contrário carrega summary.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useChannel } from '../context/ChannelContext';
import { agentApi } from '../services/agentApi';

const styles = {
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
    gap: '1rem',
    marginBottom: '1.5rem',
  },
  card: {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '1rem',
  },
  cardDestaque: {
    background: 'var(--surface)',
    border: '2px solid var(--accent)',
    borderRadius: 8,
    padding: '1rem',
    gridColumn: '1 / -1',
  },
  label: {
    fontSize: '0.8rem',
    color: 'var(--text-muted)',
    marginBottom: 4,
  },
  value: {
    fontSize: '1.25rem',
    fontWeight: 600,
  },
  alertas: {
    marginBottom: 4,
    padding: '0.75rem 1rem',
    borderRadius: 6,
    fontSize: '0.9rem',
    border: '1px solid',
  },
};

export function Dashboard() {
  const { channel } = useChannel();
  const navigate = useNavigate();
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!agentApi.getToken()) {
      navigate('/login', { replace: true });
      return;
    }
    let cancelled = false;
    agentApi
      .getSummary()
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err.message && (err.message.includes('401') || err.message.includes('Sessão') || err.message.includes('login'))) {
          return;
        }
        setError(err.message);
      });
    return () => { cancelled = true; };
  }, [navigate]);

  if (!agentApi.getToken()) {
    return null;
  }

  if (error) {
    return (
      <div style={{ color: 'var(--danger)', padding: '1rem' }}>
        Erro ao carregar: {error}
      </div>
    );
  }

  if (!summary) {
    return <p style={{ color: 'var(--text-muted)' }}>Carregando...</p>;
  }

  const canalAtivo = (summary.canalAtivo || channel || 'web').toUpperCase();
  const mensagensEnviadas = summary.mensagensEnviadas ?? 0;
  const mensagensRecebidas = summary.mensagensRecebidas ?? 0;
  const tokensEstimados = summary.tokensEstimados ?? summary.tokens ?? 0;
  const custoEstimado = summary.totalGastoMes ?? summary.custoEstimado ?? 0;

  return (
    <>
      <div style={styles.grid}>
        <div style={styles.cardDestaque}>
          <div style={styles.label}>Canal ativo</div>
          <div style={{ ...styles.value, fontSize: '1.5rem', color: 'var(--accent)' }}>{canalAtivo}</div>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4, marginBottom: 0 }}>
            Todas as requisições usam este canal (query e header x-channel).
          </p>
        </div>

        <div style={styles.card}>
          <div style={styles.label}>Mensagens enviadas</div>
          <div style={styles.value}>{String(mensagensEnviadas)}</div>
        </div>
        <div style={styles.card}>
          <div style={styles.label}>Mensagens recebidas</div>
          <div style={styles.value}>{String(mensagensRecebidas)}</div>
        </div>
        <div style={styles.card}>
          <div style={styles.label}>Tokens estimados</div>
          <div style={styles.value}>{String(tokensEstimados)}</div>
        </div>
        <div style={styles.card}>
          <div style={styles.label}>Custo estimado (mês)</div>
          <div style={styles.value}>R$ {Number(custoEstimado).toFixed(2)}</div>
        </div>
        <div style={styles.card}>
          <div style={styles.label}>Status do agente</div>
          <div style={styles.value}>{summary.agentStatus ?? '—'}</div>
        </div>
      </div>

      {summary.alertas?.length > 0 && (
        <div style={{ marginBottom: '1rem' }}>
          {summary.alertas.map((a, i) => (
            <div
              key={i}
              style={{
                ...styles.alertas,
                background: a.tipo === 'warning' ? 'rgba(210,153,34,0.15)' : 'rgba(88,166,255,0.1)',
                borderColor: a.tipo === 'warning' ? 'var(--warning)' : 'var(--accent)',
              }}
            >
              {a.texto}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
