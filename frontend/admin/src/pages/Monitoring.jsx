import { useCallback, useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import { useNavigate } from 'react-router-dom';
import { useAgentAuth } from '../context/AgentAuthContext';
import { agentApi } from '../services/agentApi';
import { useTenantLimitsContext } from '../context/TenantLimitsContext.jsx';
import { TenantPlanBadge } from '../components/tenant/TenantPlanBadge.jsx';

const card = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: '1rem',
};

const grid = {
  display: 'grid',
  gap: '1rem',
  gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
};

/** @param {unknown[]} snapshots */
function normalizeSnapshotsToChartRows(snapshots) {
  if (!Array.isArray(snapshots)) return [];
  return snapshots.map((s) => {
    const ch = s?.channels || {};
    const q = s?.queue || {};
    const d = s?.timestamp ? new Date(s.timestamp) : null;
    const time =
      d && !Number.isNaN(d.getTime())
        ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        : '—';
    return {
      time,
      ts: s?.timestamp || '',
      connected: Number(ch.connected ?? 0),
      error: Number(ch.error ?? 0),
      waiting: Number(ch.waiting ?? 0),
      queueWaiting: Number(q.waiting ?? 0),
    };
  });
}

function snapshotsLooselyEqual(a, b) {
  if (!a || !b || a.timestamp !== b.timestamp) return false;
  return (
    Number(a.channels?.connected) === Number(b.channels?.connected) &&
    Number(a.channels?.error) === Number(b.channels?.error) &&
    Number(a.queue?.waiting) === Number(b.queue?.waiting)
  );
}

/** @param {object[]} prev @param {object|null|undefined} snap @param {number} maxKeep */
function mergeSnapshot(prev, snap, maxKeep) {
  const cap = Math.max(1, Number(maxKeep) || 30);
  if (!snap?.timestamp) return prev;
  const list = [...prev];
  const last = list[list.length - 1];
  if (last && last.timestamp === snap.timestamp) {
    if (snapshotsLooselyEqual(last, snap)) return prev;
    list[list.length - 1] = snap;
    return list.slice(-cap);
  }
  if (last && snapshotsLooselyEqual(last, snap)) return prev;
  list.push(snap);
  return list.slice(-cap);
}

function risingThree(snapshots, pick) {
  if (!snapshots || snapshots.length < 3) return false;
  const slice = snapshots.slice(-3);
  const a = pick(slice[0]);
  const b = pick(slice[1]);
  const c = pick(slice[2]);
  return a < b && b < c;
}

function MultiSeriesChart({ rows }) {
  const w = 640;
  const h = 200;
  const pad = { t: 16, r: 16, b: 28, l: 40 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;

  const series = [
    { key: 'connected', color: 'var(--success, #3fb950)', label: 'Conectados' },
    { key: 'error', color: 'var(--danger, #f85149)', label: 'Erro (canais)' },
    { key: 'queueWaiting', color: 'var(--accent, #58a6ff)', label: 'Fila (waiting)' },
  ];

  const maxY = Math.max(
    1,
    ...rows.flatMap((r) => [r.connected, r.error, r.queueWaiting]),
  );

  const pointsFor = (key) => {
    if (rows.length === 0) return '';
    if (rows.length === 1) {
      const x = pad.l + innerW / 2;
      const y = pad.t + innerH - (Number(rows[0][key] ?? 0) / maxY) * innerH;
      return `${x - 1},${y} ${x + 1},${y}`;
    }
    return rows
      .map((r, i) => {
        const x = pad.l + (i / (rows.length - 1)) * innerW;
        const y = pad.t + innerH - (Number(r[key] ?? 0) / maxY) * innerH;
        return `${x},${y}`;
      })
      .join(' ');
  };

  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} style={{ maxWidth: '100%', height: 'auto' }}>
      <rect x={0} y={0} width={w} height={h} fill="transparent" />
      <text x={pad.l} y={14} fill="var(--text-muted)" fontSize="11">
        Escala máx: {maxY}
      </text>
      {series.map((s) => (
        <polyline
          key={s.key}
          fill="none"
          stroke={s.color}
          strokeWidth="2"
          points={pointsFor(s.key)}
        />
      ))}
      <g transform={`translate(0, ${h - 10})`}>
        {series.map((s, i) => (
          <g key={s.key}>
            <rect x={pad.l + i * 140} y={-8} width={10} height={10} fill={s.color} />
            <text x={pad.l + i * 140 + 14} y={0} fill="var(--text)" fontSize="10">
              {s.label}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}

export function Monitoring() {
  const { getToken } = useAgentAuth();
  const navigate = useNavigate();
  const { plan, features, loading: limitsLoading } = useTenantLimitsContext();
  const realtimeOk = Boolean(features?.realtimeMonitoring);
  const historyCap = useMemo(
    () => (features?.extendedMonitoringHistory ? 60 : 30),
    [features?.extendedMonitoringHistory],
  );
  const [metrics, setMetrics] = useState(null);
  const [snapshots, setSnapshots] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    Promise.all([
      agentApi.request('/api/monitoring/overview'),
      agentApi.request(`/api/monitoring/history?limit=${historyCap}`).catch(() => ({ snapshots: [] })),
    ])
      .then(([overview, hist]) => {
        if (!alive) return;
        setMetrics(overview);
        if (Array.isArray(hist?.snapshots)) setSnapshots(hist.snapshots.slice(-historyCap));
      })
      .catch((err) => {
        if (alive) setError(err?.message || 'Falha ao carregar monitoramento');
      });
    return () => {
      alive = false;
    };
  }, [historyCap]);

  useEffect(() => {
    if (!realtimeOk || limitsLoading) return undefined;
    const token = getToken?.();
    const agent = agentApi.getAgent?.();
    const tenantId = String(agent?.tenantId || agent?.tenant_id || '').trim();
    if (!token || !tenantId) return undefined;

    const baseUrl = import.meta.env.VITE_API_URL || window.location.origin;
    const socket = io(baseUrl, {
      transports: ['websocket'],
      withCredentials: true,
      auth: { token, tenantId },
      reconnection: true,
    });

    const onMetrics = (payload) => {
      const { latestSnapshot, ...rest } = payload || {};
      setMetrics(rest);
      if (latestSnapshot) {
        setSnapshots((prev) => mergeSnapshot(prev, latestSnapshot, historyCap));
      }
    };
    const onQueue = (payload) =>
      setMetrics((prev) => (prev ? { ...prev, queue: { ...prev.queue, ...payload } } : prev));

    socket.on('metrics:update', onMetrics);
    socket.on('queue:update', onQueue);
    return () => {
      socket.off('metrics:update', onMetrics);
      socket.off('queue:update', onQueue);
      socket.disconnect();
    };
  }, [getToken, realtimeOk, limitsLoading, historyCap]);

  const chartRows = useMemo(() => normalizeSnapshotsToChartRows(snapshots), [snapshots]);

  const lastSnapshotAt = useMemo(() => {
    if (snapshots.length > 0) return snapshots[snapshots.length - 1]?.timestamp || null;
    return metrics?.timestamp || null;
  }, [snapshots, metrics]);

  const alerts = useMemo(() => {
    if (!metrics) return [];
    const out = [];
    const total = Number(metrics?.channels?.total || 0);
    const errCount = Number(metrics?.channels?.error || 0);
    const errorRate = total > 0 ? errCount / total : 0;
    if (errorRate > 0.1) out.push('Mais de 10% dos canais estão em erro.');
    if (Number(metrics?.queue?.waiting || 0) > 100) out.push('Fila acima de 100 jobs aguardando.');
    if (metrics?.providers?.waha === 'OPEN' || metrics?.providers?.evolution === 'OPEN') {
      out.push('Circuit breaker aberto em provider.');
    }
    return out;
  }, [metrics]);

  const trendAlerts = useMemo(() => {
    const out = [];
    if (risingThree(snapshots, (s) => Number(s?.queue?.waiting ?? 0))) {
      out.push('Tendência: fila (waiting) subiu nos últimos 3 snapshots.');
    }
    if (risingThree(snapshots, (s) => Number(s?.channels?.error ?? 0))) {
      out.push('Tendência: canais em erro subiram nos últimos 3 snapshots.');
    }
    return out;
  }, [snapshots]);

  if (error) return <div style={{ color: 'var(--danger)' }}>{error}</div>;
  if (!metrics) return <p style={{ color: 'var(--text-muted)' }}>Carregando monitoramento...</p>;

  const allAlerts = [...alerts, ...trendAlerts];

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '0.5rem', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0 }}>Monitoring</h2>
          {!limitsLoading && plan != null ? <TenantPlanBadge plan={plan} /> : null}
          <span
            style={{
              fontSize: '0.78rem',
              fontWeight: 600,
              padding: '4px 10px',
              borderRadius: 999,
              border: '1px solid var(--border)',
              color: realtimeOk ? 'var(--success, #3fb950)' : 'var(--text-muted)',
            }}
          >
            Tempo real: {realtimeOk ? 'ativo' : 'indisponível no plano'}
          </span>
        </div>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          Último snapshot:{' '}
          <strong style={{ color: 'var(--text)' }}>
            {lastSnapshotAt ? new Date(lastSnapshotAt).toLocaleString('pt-BR') : '—'}
          </strong>
        </div>
      </div>

      {!limitsLoading && !realtimeOk ? (
        <div
          style={{
            ...card,
            borderColor: 'var(--accent)',
            background: 'rgba(88,166,255,0.06)',
          }}
        >
          <strong style={{ color: 'var(--text)' }}>Visão geral disponível</strong>
          <p style={{ margin: '8px 0 0', fontSize: '0.88rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Seu plano não inclui atualização de métricas em tempo real via socket. Os números abaixo refletem o último
            snapshot obtido pela API (overview). Faça upgrade para acompanhar filas e tendências ao vivo.
          </p>
          <button
            type="button"
            onClick={() => navigate('/')}
            style={{
              marginTop: 12,
              padding: '8px 14px',
              borderRadius: 8,
              border: '1px solid var(--accent)',
              background: 'transparent',
              color: 'var(--accent)',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Ver plano atual
          </button>
        </div>
      ) : null}

      {!limitsLoading && features?.autoHealing === false ? (
        <div style={{ ...card, fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
          <strong style={{ color: 'var(--text)' }}>Auto-healing</strong>
          <p style={{ margin: '6px 0 0' }}>
            Reconexão automática de canais após falha de provider não está incluída no seu plano (filas/orquestrador).
          </p>
        </div>
      ) : null}

      {!limitsLoading && features?.extendedMonitoringHistory === false ? (
        <div style={{ ...card, fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
          <strong style={{ color: 'var(--text)' }}>Histórico de gráficos</strong>
          <p style={{ margin: '6px 0 0' }}>Até 30 pontos de histórico. Plano Enterprise permite histórico estendido.</p>
        </div>
      ) : null}

      <div style={grid}>
        <div style={card}><div>Total canais</div><strong>{metrics.channels?.total ?? 0}</strong></div>
        <div style={card}><div>Conectados</div><strong>{metrics.channels?.connected ?? 0}</strong></div>
        <div style={card}><div>Em erro</div><strong>{metrics.channels?.error ?? 0}</strong></div>
        <div style={card}><div>Aguardando QR</div><strong>{metrics.channels?.waiting ?? 0}</strong></div>
        <div style={card}><div>Conectando</div><strong>{metrics.channels?.connecting ?? 0}</strong></div>
      </div>

      <div style={grid}>
        <div style={card}><div>Jobs waiting</div><strong>{metrics.queue?.waiting ?? 0}</strong></div>
        <div style={card}><div>Jobs active</div><strong>{metrics.queue?.active ?? 0}</strong></div>
        <div style={card}><div>Jobs failed</div><strong>{metrics.queue?.failed ?? 0}</strong></div>
        <div style={card}><div>Jobs completed</div><strong>{metrics.queue?.completed ?? 0}</strong></div>
      </div>

      <div style={grid}>
        <div style={card}><div>WAHA</div><strong>{metrics.providers?.waha || 'UNKNOWN'}</strong></div>
        <div style={card}><div>Evolution</div><strong>{metrics.providers?.evolution || 'UNKNOWN'}</strong></div>
      </div>

      <div style={card}>
        <div style={{ marginBottom: '0.75rem', fontWeight: 600 }}>Tendência (histórico em memória)</div>
        {chartRows.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            {!realtimeOk
              ? 'Histórico em tempo real não está disponível no seu plano. A visão acima usa apenas o snapshot atual da API.'
              : 'Ainda não há histórico. Os pontos aparecem após alguns ciclos de métricas (socket conectado) ou quando houver dados armazenados no servidor.'}
          </p>
        ) : (
          <MultiSeriesChart rows={chartRows} />
        )}
      </div>

      {allAlerts.length > 0 && (
        <div style={{ ...card, borderColor: 'var(--warning)' }}>
          <strong>Alertas</strong>
          <ul>
            {allAlerts.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
