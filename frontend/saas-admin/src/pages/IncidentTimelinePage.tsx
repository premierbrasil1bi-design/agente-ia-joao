import { useEffect, useMemo, useState } from "react";
import { Card } from "../components/ui";
import { adminApi, type SocketMetricsRange, type Tenant } from "../api/admin";
import styles from "./IncidentTimelinePage.module.css";

type Incident = {
  id?: string;
  type: "critical" | "warning" | "info";
  status: "active" | "resolved";
  provider?: string;
  tenantId?: string;
  message: string;
  timestamp: string;
  resolvedAt?: string | null;
};

const RANGE_OPTIONS: SocketMetricsRange[] = ["1h", "24h", "7d"];
const TYPE_OPTIONS = ["all", "critical", "warning", "info"] as const;
const STATUS_OPTIONS = ["all", "active", "resolved"] as const;
const PROVIDERS = ["all", "waha", "evolution", "zapi", "official"] as const;

function cutoffFromRange(range: SocketMetricsRange): number {
  const now = Date.now();
  if (range === "1h") return now - 60 * 60 * 1000;
  if (range === "7d") return now - 7 * 24 * 60 * 60 * 1000;
  return now - 24 * 60 * 60 * 1000;
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

function toCsv(rows: Incident[]) {
  const header = [
    "id",
    "type",
    "status",
    "provider",
    "tenantId",
    "message",
    "timestamp",
    "resolvedAt",
    "duration",
  ];
  const lines = rows.map((r) =>
    [
      r.id || "",
      r.type,
      r.status,
      r.provider || "",
      r.tenantId || "",
      (r.message || "").replaceAll('"', '""'),
      r.timestamp || "",
      r.resolvedAt || "",
      formatDuration(r.timestamp, r.resolvedAt),
    ]
      .map((v) => `"${String(v)}"`)
      .join(",")
  );
  return [header.join(","), ...lines].join("\n");
}

export default function IncidentTimelinePage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [range, setRange] = useState<SocketMetricsRange>("24h");
  const [status, setStatus] = useState<(typeof STATUS_OPTIONS)[number]>("all");
  const [type, setType] = useState<(typeof TYPE_OPTIONS)[number]>("all");
  const [provider, setProvider] = useState<(typeof PROVIDERS)[number]>("all");
  const [tenantId, setTenantId] = useState<string>("all");
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [incidents, setIncidents] = useState<Incident[]>([]);

  useEffect(() => {
    adminApi.getTenants().then(setTenants).catch(() => setTenants([]));
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError("");
      try {
        const data = await adminApi.getSocketMetrics({
          range,
          tenantId: tenantId !== "all" ? tenantId : undefined,
          provider: provider !== "all" ? provider : undefined,
        });
        setIncidents((data.alerts?.recent || []) as Incident[]);
      } catch (e: any) {
        setError(e?.message || "Erro ao carregar incidentes.");
        setIncidents([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [range, tenantId, provider]);

  const filtered = useMemo(() => {
    const cutoff = cutoffFromRange(range);
    return incidents
      .filter((i) => new Date(i.timestamp).getTime() >= cutoff)
      .filter((i) => (status === "all" ? true : i.status === status))
      .filter((i) => (type === "all" ? true : i.type === type))
      .filter((i) => (provider === "all" ? true : String(i.provider || "").toLowerCase() === provider))
      .filter((i) => (tenantId === "all" ? true : String(i.tenantId || "") === tenantId))
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [incidents, range, status, type, provider, tenantId]);

  const exportCsv = () => {
    const csv = toCsv(filtered);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `incident-timeline-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={styles.page}>
      <Card title="Incident Timeline">
        <div className={styles.toolbar}>
          <div className={styles.field}>
            <label>Período</label>
            <select className={styles.select} value={range} onChange={(e) => setRange(e.target.value as SocketMetricsRange)}>
              {RANGE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label>Status</label>
            <select className={styles.select} value={status} onChange={(e) => setStatus(e.target.value as any)}>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label>Tipo</label>
            <select className={styles.select} value={type} onChange={(e) => setType(e.target.value as any)}>
              {TYPE_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label>Provider</label>
            <select className={styles.select} value={provider} onChange={(e) => setProvider(e.target.value as any)}>
              {PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label>Tenant</label>
            <select className={styles.select} value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
              <option value="all">all</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nome_empresa}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className={styles.actions}>
          <button className={styles.exportBtn} onClick={exportCsv}>
            Exportar CSV
          </button>
        </div>
      </Card>

      {loading && <div className={styles.empty}>Carregando incidentes...</div>}
      {!loading && error && <div className={styles.empty}>{error}</div>}

      {!loading && !error && (
        <Card title={`Incidentes (${filtered.length})`}>
          {filtered.length === 0 ? (
            <div className={styles.empty}>Nenhum incidente para os filtros selecionados.</div>
          ) : (
            <div className={styles.timeline}>
              {filtered.map((i, idx) => (
                <div key={`${i.id || "incident"}-${idx}`} className={styles.item}>
                  <div className={styles.itemHead}>
                    <span className={`${styles.badge} ${styles[i.type]}`}>{i.type.toUpperCase()}</span>
                    <span className={`${styles.badge} ${styles[i.status]}`}>{i.status}</span>
                    {i.provider ? <span className={styles.badge}>{i.provider.toUpperCase()}</span> : null}
                    {i.tenantId ? <span className={styles.badge}>tenant {i.tenantId}</span> : null}
                  </div>
                  <div className={styles.message}>{i.message}</div>
                  <div className={styles.meta}>
                    <div>Início: {new Date(i.timestamp).toLocaleString("pt-BR")}</div>
                    <div>ResolvedAt: {i.resolvedAt ? new Date(i.resolvedAt).toLocaleString("pt-BR") : "—"}</div>
                    <div>Duração: {formatDuration(i.timestamp, i.resolvedAt)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
