import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Card } from "../components/ui";
import { adminApi, type SocketMetricsRange, type SocketMetricsResponse, type Tenant } from "../api/admin";
import styles from "./SocketMetricsPage.module.css";

type RangeOption = { value: SocketMetricsRange; label: string };

const RANGE_OPTIONS: RangeOption[] = [
  { value: "1h", label: "1 hora" },
  { value: "24h", label: "24 horas" },
  { value: "7d", label: "7 dias" },
];

const PROVIDERS = ["waha", "evolution", "zapi", "official"];

function buildTrendPoints(range: SocketMetricsRange, totalEvents: number): number[] {
  const buckets = range === "1h" ? 12 : range === "24h" ? 24 : 7;
  if (totalEvents <= 0) return Array.from({ length: buckets }, () => 0);
  const base = totalEvents / buckets;
  return Array.from({ length: buckets }, (_, i) => {
    const wave = Math.sin((i / buckets) * Math.PI * 2) * 0.22;
    const scaled = base * (1 + wave);
    return Math.max(0, Math.round(scaled));
  });
}

function toLinePath(points: number[], width: number, height: number): string {
  const max = Math.max(1, ...points);
  const pad = 12;
  const w = width - pad * 2;
  const h = height - pad * 2;
  return points
    .map((p, i) => {
      const x = pad + (i * w) / Math.max(1, points.length - 1);
      const y = pad + h - (p / max) * h;
      return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
}

function maxValue(map: Record<string, number>) {
  const vals = Object.values(map || {});
  return vals.length ? Math.max(...vals) : 1;
}

function formatDuration(startIso?: string, endIso?: string | null) {
  if (!startIso) return "—";
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  const sec = Math.max(0, Math.floor((end - start) / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export default function SocketMetricsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const readRange = (searchParams.get("range") || "24h") as SocketMetricsRange;
  const range = RANGE_OPTIONS.some((o) => o.value === readRange) ? readRange : "24h";
  const tenantId = searchParams.get("tenantId") || "";
  const provider = searchParams.get("provider") || "";
  const autoRefreshFromUrl = (searchParams.get("autoRefresh") || "true").toLowerCase() !== "false";
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [metrics, setMetrics] = useState<SocketMetricsResponse | null>(null);
  const [autoRefresh, setAutoRefresh] = useState<boolean>(autoRefreshFromUrl);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [secondsSinceUpdate, setSecondsSinceUpdate] = useState<number>(0);

  useEffect(() => {
    setAutoRefresh(autoRefreshFromUrl);
  }, [autoRefreshFromUrl]);

  function updateUrlFilters(next: {
    range?: SocketMetricsRange;
    tenantId?: string;
    provider?: string;
    autoRefresh?: boolean;
  }) {
    const r = next.range ?? range;
    const t = next.tenantId ?? tenantId;
    const p = next.provider ?? provider;
    const a = next.autoRefresh ?? autoRefresh;
    const qs = new URLSearchParams();
    qs.set("range", r);
    if (t) qs.set("tenantId", t);
    if (p) qs.set("provider", p);
    qs.set("autoRefresh", String(a));
    setSearchParams(qs, { replace: true });
  }

  useEffect(() => {
    adminApi.getTenants().then(setTenants).catch(() => setTenants([]));
  }, []);

  const loadMetrics = useMemo(
    () => async () => {
      setLoading(true);
      setError("");
      try {
        const data = await adminApi.getSocketMetrics({
          range,
          tenantId: tenantId || undefined,
          provider: provider || undefined,
        });
        setMetrics(data);
        setLastUpdatedAt(Date.now());
      } catch (e: any) {
        const msg = e?.message || "Falha ao carregar métricas.";
        if (msg.includes("503") || msg.toLowerCase().includes("indisponível")) {
          setError("Métricas temporariamente indisponíveis (Redis/Socket). Exibindo fallback.");
        } else {
          setError(msg);
        }
        setMetrics({
          range,
          filters: { tenantId: tenantId || null, provider: provider || null },
          totals: { events: 0, errors: 0, errorRatePercent: 0, eventsPerMinuteAvg: 0 },
          breakdown: { tenants: {}, providers: {}, errorsByTenant: {}, errorsByProvider: {} },
          alerts: { active: [], recent: [] },
          computedAt: new Date().toISOString(),
        });
        setLastUpdatedAt(Date.now());
      } finally {
        setLoading(false);
      }
    },
    [range, tenantId, provider]
  );

  useEffect(() => {
    loadMetrics();
  }, [loadMetrics]);

  useEffect(() => {
    if (!autoRefresh) return;
    const int = setInterval(() => {
      loadMetrics();
    }, 15000);
    return () => clearInterval(int);
  }, [autoRefresh, loadMetrics]);

  useEffect(() => {
    const int = setInterval(() => {
      if (!lastUpdatedAt) return setSecondsSinceUpdate(0);
      setSecondsSinceUpdate(Math.max(0, Math.floor((Date.now() - lastUpdatedAt) / 1000)));
    }, 1000);
    return () => clearInterval(int);
  }, [lastUpdatedAt]);

  const trend = useMemo(
    () => buildTrendPoints(range, metrics?.totals.events ?? 0),
    [range, metrics?.totals.events]
  );
  const linePath = useMemo(() => toLinePath(trend, 760, 220), [trend]);
  const providerMax = useMemo(() => maxValue(metrics?.breakdown.providers || {}), [metrics?.breakdown.providers]);
  const providerErrMax = useMemo(() => maxValue(metrics?.breakdown.errorsByProvider || {}), [metrics?.breakdown.errorsByProvider]);
  const tenantMax = useMemo(() => maxValue(metrics?.breakdown.tenants || {}), [metrics?.breakdown.tenants]);
  const errorRate = metrics?.totals.errorRatePercent ?? 0;
  const healthMeta =
    errorRate < 2
      ? { label: "Saudável", color: "#166534", bg: "#dcfce7" }
      : errorRate <= 5
        ? { label: "Atenção", color: "#92400e", bg: "#fef3c7" }
        : { label: "Crítico", color: "#991b1b", bg: "#fee2e2" };
  const topProvidersWithErrors = useMemo(
    () =>
      Object.entries(metrics?.breakdown.errorsByProvider || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5),
    [metrics?.breakdown.errorsByProvider]
  );

  return (
    <div className={styles.page}>
      <Card title="Métricas de Canais (Socket.IO)">
        <div className={styles.toolbar}>
          <div className={styles.field}>
            <label>Range</label>
            <select
              className={styles.select}
              value={range}
              onChange={(e) => updateUrlFilters({ range: e.target.value as SocketMetricsRange })}
            >
              {RANGE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label>Tenant</label>
            <select
              className={styles.select}
              value={tenantId}
              onChange={(e) => updateUrlFilters({ tenantId: e.target.value })}
            >
              <option value="">Todos</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nome_empresa}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label>Provider</label>
            <select
              className={styles.select}
              value={provider}
              onChange={(e) => updateUrlFilters({ provider: e.target.value })}
            >
              <option value="">Todos</option>
              {PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {p.toUpperCase()}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label>Auto-refresh</label>
            <button
              type="button"
              className={styles.toggle}
              onClick={() => {
                const next = !autoRefresh;
                setAutoRefresh(next);
                updateUrlFilters({ autoRefresh: next });
              }}
            >
              {autoRefresh ? "ON (15s)" : "OFF"}
            </button>
          </div>
          <div className={styles.field}>
            <label>Análise</label>
            <button
              type="button"
              className={styles.toggle}
              onClick={async () => {
                const link = window.location.href;
                try {
                  await navigator.clipboard.writeText(link);
                  setError("");
                } catch {
                  setError("Não foi possível copiar automaticamente. Copie a URL manualmente.");
                }
              }}
            >
              Copiar link da análise
            </button>
          </div>
          <div className={styles.field}>
            <label>Última atualização</label>
            <div className={styles.small}>{lastUpdatedAt ? `Atualizado há ${secondsSinceUpdate}s` : "—"}</div>
          </div>
        </div>
        <div className={styles.healthWrap}>
          <span className={styles.small}>Saúde geral</span>
          <span className={styles.healthPill} style={{ background: healthMeta.bg, color: healthMeta.color }}>
            {healthMeta.label} ({errorRate.toFixed(2)}%)
          </span>
        </div>
      </Card>

      {loading && <div className={styles.loading}>Carregando métricas...</div>}
      {!loading && error && <div className={styles.errorBox}>{error}</div>}
      {!loading && (metrics?.alerts?.active || []).length > 0 && (
        <div className={styles.alertBox}>
          {(metrics?.alerts?.active || []).map((a, idx) => (
            <div key={`${a.timestamp}-${idx}`}>
              {a.type === "critical" ? "Alerta crítico" : "Alerta de atenção"}: {a.message}
            </div>
          ))}
        </div>
      )}
      {!loading && errorRate > 5 && (
        <div className={styles.alertBox}>
          Alerta operacional: taxa de erro acima de 5%. Revise providers com falha.
        </div>
      )}

      <div className={styles.cards}>
        <Card>
          <div className={styles.metricLabel}>Total de eventos</div>
          <div className={styles.metricValue}>{(metrics?.totals.events ?? 0).toLocaleString("pt-BR")}</div>
        </Card>
        <Card>
          <div className={styles.metricLabel}>Total de erros</div>
          <div className={styles.metricValue}>{(metrics?.totals.errors ?? 0).toLocaleString("pt-BR")}</div>
        </Card>
        <Card>
          <div className={styles.metricLabel}>Taxa de erro (%)</div>
          <div className={styles.metricValue}>{(metrics?.totals.errorRatePercent ?? 0).toFixed(2)}%</div>
        </Card>
        <Card>
          <div className={styles.metricLabel}>Eventos por minuto</div>
          <div className={styles.metricValue}>{(metrics?.totals.eventsPerMinuteAvg ?? 0).toFixed(4)}</div>
        </Card>
      </div>

      <Card>
        <div className={styles.chartTitle}>Tendência de eventos</div>
        <div className={styles.lineWrap}>
          <svg width="100%" viewBox="0 0 760 220" role="img" aria-label="Tendência de eventos">
            <path d={linePath} fill="none" stroke="#3b82f6" strokeWidth="2.5" />
          </svg>
          <div className={styles.small}>Trend aproximado por bucket do período selecionado.</div>
        </div>
      </Card>

      <Card>
        <div className={styles.chartTitle}>Eventos por provider</div>
        <div className={styles.bars}>
          {Object.entries(metrics?.breakdown.providers || {}).map(([k, v]) => (
            <div key={k} className={styles.barRow}>
              <div>{k.toUpperCase()}</div>
              <div className={styles.barTrack}>
                <div className={styles.barFill} style={{ width: `${(v / providerMax) * 100}%`, background: "#2563eb" }} />
              </div>
              <div>{v}</div>
            </div>
          ))}
        </div>
        <div className={styles.chartTitle} style={{ marginTop: "1rem" }}>Erros por provider</div>
        <div className={styles.bars}>
          {Object.entries(metrics?.breakdown.errorsByProvider || {}).map(([k, v]) => (
            <div key={k} className={styles.barRow}>
              <div>{k.toUpperCase()}</div>
              <div className={styles.barTrack}>
                <div className={styles.barFill} style={{ width: `${(v / providerErrMax) * 100}%`, background: "#dc2626" }} />
              </div>
              <div>{v}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <div className={styles.chartTitle}>Eventos por tenant</div>
        <div className={styles.bars}>
          {Object.entries(metrics?.breakdown.tenants || {}).map(([k, v]) => (
            <div key={k} className={styles.barRow}>
              <div>{k}</div>
              <div className={styles.barTrack}>
                <div className={styles.barFill} style={{ width: `${(v / tenantMax) * 100}%`, background: "#16a34a" }} />
              </div>
              <div>{v}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <div className={styles.chartTitle}>Top problemas (providers com mais erros)</div>
        <div className={styles.bars}>
          {topProvidersWithErrors.length === 0 ? (
            <div className={styles.small}>Sem erros relevantes no período selecionado.</div>
          ) : (
            topProvidersWithErrors.map(([k, v]) => (
              <div key={k} className={styles.barRow}>
                <div>{k.toUpperCase()}</div>
                <div className={styles.barTrack}>
                  <div className={styles.barFill} style={{ width: `${(v / providerErrMax) * 100}%`, background: "#ef4444" }} />
                </div>
                <div>{v}</div>
              </div>
            ))
          )}
        </div>
      </Card>

      <Card>
        <div className={styles.chartTitle}>Alertas recentes</div>
        <div className={styles.bars}>
          {(metrics?.alerts?.recent || []).length === 0 ? (
            <div className={styles.small}>Sem alertas recentes.</div>
          ) : (
            (metrics?.alerts?.recent || []).slice(0, 10).map((a, idx) => (
              <div key={`${a.timestamp}-${idx}`} className={styles.alertRow}>
                <span
                  className={
                    a.type === "critical"
                      ? styles.alertTagCritical
                      : a.type === "warning"
                        ? styles.alertTagWarning
                        : styles.alertTagInfo
                  }
                >
                  {a.type === "critical" ? "CRÍTICO" : a.type === "warning" ? "ATENÇÃO" : "INFO"}
                </span>
                <span>
                  {a.message}{" "}
                  <strong style={{ marginLeft: 6 }}>
                    [{a.status === "active" ? "ativo" : "resolvido"}]
                  </strong>
                </span>
                <span className={styles.small}>
                  {a.provider ? `${a.provider.toUpperCase()} · ` : ""}
                  {a.tenantId ? `tenant ${a.tenantId} · ` : ""}
                  início {new Date(a.timestamp).toLocaleString("pt-BR")} · duração{" "}
                  {formatDuration(a.timestamp, a.resolvedAt)}
                </span>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
