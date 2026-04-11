/**
 * Dashboard Client App – GET /api/agent/dashboard/summary.
 * Sem token → redirect /login. Requisição envia automaticamente Authorization: Bearer <token>.
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { agentApi } from '../services/agentApi';
import { useTenantLimitsContext } from '../context/TenantLimitsContext.jsx';
import { TenantUsageCard } from '../components/tenant/TenantUsageCard.jsx';
import { TenantPlanBadge } from '../components/tenant/TenantPlanBadge.jsx';

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
  const navigate = useNavigate();
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);
  const { loading: limitsLoading, plan, limits, usage, features } = useTenantLimitsContext();

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

  const canalAtivo = (summary.canalAtivo || 'web').toUpperCase();
  const mensagensEnviadas = summary.mensagensEnviadas ?? 0;
  const mensagensRecebidas = summary.mensagensRecebidas ?? 0;
  const tokensEstimados = summary.tokensEstimados ?? summary.tokens ?? 0;
  const custoEstimado = summary.totalGastoMes ?? summary.custoEstimado ?? 0;

  return (
    <>
      <div style={{ marginBottom: '1.25rem' }} id="current-plan-card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
          <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--text)' }}>Plano e uso</h2>
          <TenantPlanBadge plan={plan} />
        </div>
        <TenantUsageCard
          plan={plan}
          limits={limits}
          usage={usage}
          features={features}
          loading={limitsLoading}
        />
        <p style={{ margin: '12px 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
          Precisa de mais canais, agentes ou mensagens?{' '}
          <a href="mailto:comercial@omnia1biai.com.br?subject=Upgrade%20de%20plano" style={{ color: 'var(--accent)' }}>
            Fale com o comercial
          </a>
        </p>
      </div>

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
