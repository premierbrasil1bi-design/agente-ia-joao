import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { messagesService } from '../services/messages.service.js';
import { channelsService } from '../services/channels.service.js';
import styles from './Dashboard.module.css';

const RANGE_PRESETS = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

function pct(value) {
  return `${Number(value || 0) * 100}`.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') + '%';
}

function ms(value) {
  if (value == null) return '-';
  if (value < 1000) return `${value}ms`;
  const sec = value / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = sec / 60;
  if (min < 60) return `${min.toFixed(1)}min`;
  const hr = min / 60;
  return `${hr.toFixed(1)}h`;
}

function qualityClass(level) {
  if (level === 'HIGH') return styles.qualityHigh;
  if (level === 'MEDIUM') return styles.qualityMedium;
  return styles.qualityLow;
}

function calculateDelta(channelValue, globalValue) {
  const c = Number(channelValue);
  const g = Number(globalValue);
  if (!Number.isFinite(c) || !Number.isFinite(g) || g === 0) {
    return { diff: null, percentage: null };
  }
  const diff = c - g;
  const percentage = (diff / g) * 100;
  return { diff, percentage };
}

function calculateDeltaPP(channelValue, globalValue) {
  const c = Number(channelValue);
  const g = Number(globalValue);
  if (!Number.isFinite(c) || !Number.isFinite(g)) {
    return { diff: null };
  }
  return { diff: c - g };
}

export function Dashboard() {
  const [range, setRange] = useState('7d');
  const [channelId, setChannelId] = useState(() => localStorage.getItem('dashboard_channel_filter') || '');
  const [deltaMode, setDeltaMode] = useState(() => localStorage.getItem('dashboard_delta_mode') || 'relative');
  const [channels, setChannels] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [globalMetrics, setGlobalMetrics] = useState(null);
  const [trend, setTrend] = useState([]);
  const [channelRanking, setChannelRanking] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingChannels, setLoadingChannels] = useState(true);
  const [loadingRanking, setLoadingRanking] = useState(true);
  const [error, setError] = useState(null);

  const rangeWindow = useMemo(() => RANGE_PRESETS[range] || RANGE_PRESETS['7d'], [range]);
  const filters = useMemo(() => {
    const to = new Date();
    const from = new Date(to.getTime() - rangeWindow);
    return { from: from.toISOString(), to: to.toISOString(), channelId: channelId || null };
  }, [rangeWindow, channelId]);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setLoadingRanking(true);
    setError(null);
    try {
      const [m, g] = await Promise.all([
        messagesService.getMetrics(filters),
        channelId ? messagesService.getMetrics({ ...filters, channelId: null }) : Promise.resolve(null),
      ]);
      setMetrics(m);
      setGlobalMetrics(g);
      const alertList = await messagesService.getAlerts(channelId || null);
      const sortedAlerts = (Array.isArray(alertList) ? alertList : []).sort((a, b) => {
        const w = (s) => (s === 'HIGH' ? 2 : s === 'MEDIUM' ? 1 : 0);
        return w(b.severity) - w(a.severity);
      });
      setAlerts(sortedAlerts);

      const bucketCount = range === '24h' ? 12 : range === '7d' ? 14 : 15;
      const bucketMs = Math.max(1, Math.floor(rangeWindow / bucketCount));
      const now = Date.now();
      const reqs = [];
      for (let i = bucketCount - 1; i >= 0; i -= 1) {
        const toMs = now - i * bucketMs;
        const fromMs = toMs - bucketMs;
        reqs.push(
          messagesService.getMetrics({
            from: new Date(fromMs).toISOString(),
            to: new Date(toMs).toISOString(),
            channelId: channelId || null,
          })
        );
      }
      const trendRes = await Promise.all(reqs);
      setTrend(
        trendRes.map((item, idx) => ({
          name: `T${idx + 1}`,
          p95Delivery: item?.deliveryPercentiles?.p95 ?? null,
        }))
      );

      const baseChannels = Array.isArray(channels) ? channels : [];
      if (baseChannels.length > 0) {
        const rankingMetrics = await Promise.all(
          baseChannels.map(async (ch) => {
            const id = String(ch?.id || '');
            if (!id) return null;
            const mm = await messagesService.getMetrics({ ...filters, channelId: id });
            return {
              id,
              name: ch?.name || `Canal ${id.slice(0, 6)}`,
              provider: ch?.provider || '-',
              status: ch?.status || ch?.connection_status || 'UNKNOWN',
              p95: mm?.deliveryPercentiles?.p95 ?? null,
              deliveredRate: mm?.deliveredRate ?? 0,
              failedRate: mm?.failedRate ?? 0,
            };
          })
        );
        const sorted = rankingMetrics
          .filter(Boolean)
          .sort((a, b) => (Number(b.p95 ?? -1) - Number(a.p95 ?? -1)));
        setChannelRanking(sorted);
      } else {
        setChannelRanking([]);
      }
    } catch (err) {
      setError(err?.message || 'Falha ao carregar dashboard.');
    } finally {
      setLoading(false);
      setLoadingRanking(false);
    }
  }, [filters, range, rangeWindow, channelId, channels]);

  const loadChannels = useCallback(async () => {
    setLoadingChannels(true);
    try {
      const data = await channelsService.listAgentChannels();
      setChannels(Array.isArray(data) ? data : []);
    } catch {
      setChannels([]);
    } finally {
      setLoadingChannels(false);
    }
  }, []);

  useEffect(() => {
    loadChannels();
  }, [loadChannels]);

  useEffect(() => {
    localStorage.setItem('dashboard_channel_filter', channelId);
  }, [channelId]);

  useEffect(() => {
    localStorage.setItem('dashboard_delta_mode', deltaMode);
  }, [deltaMode]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const kpis = useMemo(
    () => [
      { label: 'Total Messages', value: metrics?.totalMessages ?? 0 },
      { label: 'Delivered Rate', value: pct(metrics?.deliveredRate), tone: 'ok' },
      { label: 'Read Rate', value: pct(metrics?.readRate), tone: 'info' },
      { label: 'Failed Rate', value: pct(metrics?.failedRate), tone: 'danger' },
    ],
    [metrics]
  );

  const deltas = useMemo(() => {
    if (!channelId || !metrics || !globalMetrics) return null;
    return {
      deliveredRate: {
        relative: calculateDelta(metrics?.deliveredRate, globalMetrics?.deliveredRate),
        pp: calculateDeltaPP(metrics?.deliveredRate, globalMetrics?.deliveredRate),
      },
      readRate: {
        relative: calculateDelta(metrics?.readRate, globalMetrics?.readRate),
        pp: calculateDeltaPP(metrics?.readRate, globalMetrics?.readRate),
      },
      failedRate: {
        relative: calculateDelta(metrics?.failedRate, globalMetrics?.failedRate),
        pp: calculateDeltaPP(metrics?.failedRate, globalMetrics?.failedRate),
      },
      p95Delivery: {
        relative: calculateDelta(metrics?.deliveryPercentiles?.p95, globalMetrics?.deliveryPercentiles?.p95),
      },
      p95Read: {
        relative: calculateDelta(metrics?.readPercentiles?.p95, globalMetrics?.readPercentiles?.p95),
      },
    };
  }, [channelId, metrics, globalMetrics]);

  const deltaDescriptor = (delta, invert = false, metricType = 'rate') => {
    if (!delta) return null;
    const usePP = metricType === 'rate' && deltaMode === 'pp';
    const baseValue = usePP ? (delta.pp?.diff != null ? delta.pp.diff * 100 : null) : delta.relative?.percentage;
    if (baseValue == null) return null;
    const absValue = Math.abs(baseValue);
    const isEqual = absValue < 0.1;
    const isBetter = invert ? baseValue < 0 : baseValue > 0;
    const tone = isEqual ? 'neutral' : isBetter ? 'positive' : 'negative';
    const formatted = absValue.toFixed(1).replace(/\.0$/, '');
    const suffix = usePP ? 'pp' : '%';
    const text = isEqual ? `0${suffix} igual` : `${formatted}${suffix} ${isBetter ? 'melhor' : 'pior'}`;
    return (
      <span className={`${styles.delta} ${styles[`delta_${tone}`]}`}>
        {text} <span className={styles.deltaHint}>vs média global</span>
      </span>
    );
  };

  const channelOptions = useMemo(() => {
    const mapped = channels.map((ch) => ({
      id: String(ch?.id || ''),
      label: `${ch?.name || 'Sem nome'} · ${String(ch?.provider || '-').toUpperCase()} · ${String(ch?.status || ch?.connection_status || 'unknown').toUpperCase()}`,
    }));
    return [{ id: '', label: 'Todos os canais' }, ...mapped.filter((x) => x.id)];
  }, [channels]);

  const p95LevelClass = (v) => {
    if (v == null) return styles.p95Medium;
    if (v <= 5000) return styles.p95Low;
    if (v <= 20000) return styles.p95Medium;
    return styles.p95High;
  };

  if (error) {
    return (
      <div className={styles.page}>
        <h1>Dashboard Executivo</h1>
        <div className={styles.danger}>Erro ao carregar dashboard: {error}</div>
        <button className={styles.retry} onClick={loadDashboard}>Tentar novamente</button>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Dashboard Executivo</h1>
          <p>Monitoramento de SLA, qualidade de dados e outliers.</p>
          <div className={styles.alertBadgeTop}>
            {alerts.length > 0 ? `🚨 ${alerts.length} alertas ativos` : 'Sem alertas ativos'}
          </div>
        </div>
        <div className={styles.filters}>
          <div className={styles.deltaModeToggle}>
            <button
              type="button"
              className={`${styles.deltaModeBtn} ${deltaMode === 'relative' ? styles.deltaModeBtnActive : ''}`}
              onClick={() => setDeltaMode('relative')}
            >
              %
            </button>
            <button
              type="button"
              className={`${styles.deltaModeBtn} ${deltaMode === 'pp' ? styles.deltaModeBtnActive : ''}`}
              onClick={() => setDeltaMode('pp')}
            >
              pp
            </button>
          </div>
          <select value={range} onChange={(e) => setRange(e.target.value)}>
            <option value="24h">Last 24h</option>
            <option value="7d">Last 7d</option>
            <option value="30d">Last 30d</option>
          </select>
          <select
            value={channelId}
            onChange={(e) => setChannelId(e.target.value)}
            disabled={loadingChannels}
          >
            {channelOptions.map((op) => (
              <option key={op.id || 'all'} value={op.id}>{op.label}</option>
            ))}
          </select>
        </div>
      </header>

      <div className={styles.grid}>
        {kpis.map((kpi) => (
          <section key={kpi.label} className={`${styles.card} ${kpi.tone ? styles[kpi.tone] : ''}`}>
            {loading ? (
              <div className={styles.skeleton} />
            ) : (
              <>
                <div className={styles.kpiLabel}>{kpi.label}</div>
                <div className={styles.kpiValue}>{kpi.value}</div>
                {channelId && kpi.label === 'Delivered Rate' && deltaDescriptor(deltas?.deliveredRate, false, 'rate')}
                {channelId && kpi.label === 'Read Rate' && deltaDescriptor(deltas?.readRate, false, 'rate')}
                {channelId && kpi.label === 'Failed Rate' && deltaDescriptor(deltas?.failedRate, true, 'rate')}
              </>
            )}
          </section>
        ))}
      </div>

      <div className={styles.panelGrid}>
        <section className={styles.card}>
          <h2 className={styles.sectionTitle}>SLA Panel</h2>
          {loading ? <div className={styles.skeletonLarge} /> : (
            <div className={styles.twoCols}>
              <div>
                <h3>Delivery</h3>
                <p>avg: {ms(metrics?.avgDeliveryTime)}</p>
                <p>p50: {ms(metrics?.deliveryPercentiles?.p50)}</p>
                <p>p95: {ms(metrics?.deliveryPercentiles?.p95)}</p>
                {channelId && (
                  <p className={styles.deltaLine}>({deltaDescriptor(deltas?.p95Delivery, true, 'time')})</p>
                )}
                <p>p99: {ms(metrics?.deliveryPercentiles?.p99)}</p>
              </div>
              <div>
                <h3>Read</h3>
                <p>avg: {ms(metrics?.avgReadTime)}</p>
                <p>p50: {ms(metrics?.readPercentiles?.p50)}</p>
                <p>p95: {ms(metrics?.readPercentiles?.p95)}</p>
                {channelId && (
                  <p className={styles.deltaLine}>({deltaDescriptor(deltas?.p95Read, true, 'time')})</p>
                )}
                <p>p99: {ms(metrics?.readPercentiles?.p99)}</p>
              </div>
            </div>
          )}
        </section>

        <section className={styles.card}>
          <h2 className={styles.sectionTitle}>Data Quality</h2>
          {loading ? <div className={styles.skeletonLarge} /> : (
            <div className={styles.list}>
              <p>deliverySampleSize: <strong>{metrics?.deliverySampleSize ?? 0}</strong></p>
              <p>readSampleSize: <strong>{metrics?.readSampleSize ?? 0}</strong></p>
              <p>deliveryCoverage: <strong>{pct(metrics?.deliveryCoverage)}</strong></p>
              <p>readCoverage: <strong>{pct(metrics?.readCoverage)}</strong></p>
              <div className={styles.badges}>
                <span className={`${styles.badge} ${qualityClass(metrics?.dataQuality?.delivery)}`}>
                  Delivery {metrics?.dataQuality?.delivery || 'LOW'}
                </span>
                <span className={`${styles.badge} ${qualityClass(metrics?.dataQuality?.read)}`}>
                  Read {metrics?.dataQuality?.read || 'LOW'}
                </span>
              </div>
            </div>
          )}
        </section>

        <section className={styles.card}>
          <h2 className={styles.sectionTitle}>Outliers</h2>
          {loading ? <div className={styles.skeletonLarge} /> : (
            <div className={styles.list}>
              <p>deliveryOutliersIgnored: <strong>{metrics?.deliveryOutliersIgnored ?? 0}</strong></p>
              <p>readOutliersIgnored: <strong>{metrics?.readOutliersIgnored ?? 0}</strong></p>
              <p>deliveryOutlierRate: <strong>{pct(metrics?.deliveryOutlierRate)}</strong></p>
              <p>readOutlierRate: <strong>{pct(metrics?.readOutlierRate)}</strong></p>
            </div>
          )}
        </section>

        <section className={`${styles.card} ${styles.chartCard}`}>
          <h2 className={styles.sectionTitle}>Alertas</h2>
          {loading ? (
            <div className={styles.skeletonLarge} />
          ) : alerts.length === 0 ? (
            <p className={styles.muted}>Nenhum alerta ativo no momento.</p>
          ) : (
            <div className={styles.alertList}>
              {alerts.map((alert) => (
                <div key={alert.id} className={`${styles.alertItem} ${alert.severity === 'HIGH' ? styles.alertHigh : styles.alertMedium}`}>
                  <span>{alert.severity === 'HIGH' ? '🔴' : '🟡'}</span>
                  <span>{alert.message}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className={`${styles.card} ${styles.chartCard}`}>
          <h2 className={styles.sectionTitle}>P95 Delivery ao Longo do Tempo</h2>
          {loading ? <div className={styles.skeletonChart} /> : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#263142" />
                <XAxis dataKey="name" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip
                  formatter={(value) => ms(value)}
                  contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8 }}
                />
                <Line type="monotone" dataKey="p95Delivery" stroke="#38bdf8" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </section>

        <section className={`${styles.card} ${styles.chartCard}`}>
          <h2 className={styles.sectionTitle}>Performance por Canal</h2>
          {loadingRanking ? (
            <div className={styles.skeletonLarge} />
          ) : channelRanking.length === 0 ? (
            <p className={styles.muted}>Nenhum canal encontrado para o período.</p>
          ) : (
            <div className={styles.rankingList}>
              {channelRanking.map((item) => (
                <button
                  key={item.id}
                  className={`${styles.rankingItem} ${channelId === item.id ? styles.rankingItemActive : ''}`}
                  onClick={() => setChannelId(item.id)}
                >
                  <div className={styles.rankingMain}>
                    <strong>{item.name}</strong>
                    <span className={styles.muted}>{String(item.provider).toUpperCase()} · {String(item.status).toUpperCase()}</span>
                  </div>
                  <div className={styles.rankingStats}>
                    <span className={`${styles.badge} ${p95LevelClass(item.p95)}`}>p95 {ms(item.p95)}</span>
                    <span>dRate {pct(item.deliveredRate)}</span>
                    <span>fRate {pct(item.failedRate)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
