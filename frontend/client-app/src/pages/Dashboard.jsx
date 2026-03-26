/**
 * Dashboard AGENTE IA OMNICANAL – GET /api/agent/dashboard/summary.
 * Se agent_token não existir → redirect /login. Caso contrário carrega summary.
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useChannel } from '../context/ChannelContext';
import { agentApi } from '../services/agentApi';
import AlertBanner from '../components/AlertBanner';
import AlertList from '../components/AlertList';
import styles from './Dashboard.module.css';

function normalizeAlert(item) {
  return {
    type: (item?.type || item?.tipo || 'info').toLowerCase(),
    message: item?.message || item?.texto || 'Alerta operacional',
    timestamp: item?.timestamp || item?.createdAt || new Date().toISOString(),
  };
}

export function Dashboard() {
  const { channel } = useChannel();
  const navigate = useNavigate();
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);
  const [metricAlerts, setMetricAlerts] = useState([]);

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

  useEffect(() => {
    let cancelled = false;
    const loadMetricsAlerts = async () => {
      try {
        const data = await agentApi.request('/api/global-admin/socket-metrics?range=1h');
        if (cancelled) return;
        const alerts = Array.isArray(data?.alerts) ? data.alerts.map(normalizeAlert) : [];
        setMetricAlerts(alerts.slice(0, 5));
      } catch {
        if (!cancelled) setMetricAlerts([]);
      }
    };
    loadMetricsAlerts();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!agentApi.getToken()) {
    return null;
  }

  if (error) {
    return (
      <div className={styles.danger}>
        Erro ao carregar: {error}
      </div>
    );
  }

  if (!summary) {
    return <p className={styles.muted}>Carregando...</p>;
  }

  const canalAtivo = (summary.canalAtivo || channel || 'web').toUpperCase();
  const mensagensEnviadas = summary.mensagensEnviadas ?? 0;
  const mensagensRecebidas = summary.mensagensRecebidas ?? 0;
  const tokensEstimados = summary.tokensEstimados ?? summary.tokens ?? 0;
  const custoEstimado = summary.totalGastoMes ?? summary.custoEstimado ?? 0;
  const mergedAlerts = useMemo(() => {
    const summaryAlerts = Array.isArray(summary.alertas) ? summary.alertas.map(normalizeAlert) : [];
    return [...metricAlerts, ...summaryAlerts].slice(0, 6);
  }, [metricAlerts, summary.alertas]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>Dashboard</h1>
        <p>Visao geral de canais, uso e alertas operacionais.</p>
      </header>

      <div className={styles.grid}>
        <div className={`${styles.card} ${styles.accent}`}>
          <div className={styles.kpiLabel}>Canal ativo</div>
          <div className={styles.kpiValue}>{canalAtivo}</div>
          <p className={styles.muted}>
            Todas as requisições usam este canal (query e header x-channel).
          </p>
        </div>

        <div className={styles.card}>
          <div className={styles.kpiLabel}>Mensagens enviadas</div>
          <div className={styles.kpiValue}>{String(mensagensEnviadas)}</div>
        </div>
        <div className={styles.card}>
          <div className={styles.kpiLabel}>Mensagens recebidas</div>
          <div className={styles.kpiValue}>{String(mensagensRecebidas)}</div>
        </div>
        <div className={styles.card}>
          <div className={styles.kpiLabel}>Tokens estimados</div>
          <div className={styles.kpiValue}>{String(tokensEstimados)}</div>
        </div>
        <div className={styles.card}>
          <div className={styles.kpiLabel}>Custo estimado (mes)</div>
          <div className={styles.kpiValue}>R$ {Number(custoEstimado).toFixed(2)}</div>
        </div>
        <div className={styles.card}>
          <div className={styles.kpiLabel}>Status do agente</div>
          <div className={styles.kpiValue}>{summary.agentStatus ?? '-'}</div>
        </div>
      </div>

      {mergedAlerts.length > 0 && <AlertBanner alert={mergedAlerts[0]} />}

      <section className={styles.card}>
        <h2 className={styles.sectionTitle}>Alertas recentes</h2>
        <AlertList alerts={mergedAlerts} />
      </section>
    </div>
  );
}
