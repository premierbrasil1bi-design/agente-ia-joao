import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Input, Modal, Table, TableBody, TableHead, TableRow } from "../components/ui";
import { request } from "../api/http";
import { getSessionOperations, type SessionOperationsPayload } from "../services/sessionOperations.service";
import { getSocket } from "../services/socket.service";
import { useSocketStatus } from "../hooks/useSocketStatus";

type SessionRow = {
  channelId: string;
  provider: string;
  sessionName: string;
  status: string;
  tenantId?: string;
};

type MonitorState = {
  lastRunAt: string | null;
  lastDurationMs: number;
  lastChecked: number;
  lastRecovered: number;
};

type RuntimeState = {
  providers: { failures: [string, { count: number; blockedUntil: number }][] };
  locks: { active: number };
  cache: { size: number };
};

type OperationsData = SessionOperationsPayload & {
  sessions: SessionRow[];
  backoff: Array<{ key: string; attemptsInWindow: number; failures: number; nextAllowedAt: number }>;
  metrics: { statusByProvider: Record<string, Record<string, number>> };
  monitor: MonitorState;
  runtime: RuntimeState;
};

type MessagingHealth = {
  status: "OK" | "DEGRADED" | "DOWN";
  timestamp: string;
  queue?: { activeRequests: number; maxConcurrent: number };
};

type TelemetryResponse = {
  messages: Record<string, number>;
  providers: Record<string, { success: number; failure: number }>;
  registry: Record<string, number>;
  sessionMonitor?: { reconnectionAttempts: number; failovers: number; recoverySuccess: number };
  uptime: number;
  timestamp: string;
};

const DEFAULT_MONITOR: MonitorState = {
  lastRunAt: null,
  lastDurationMs: 0,
  lastChecked: 0,
  lastRecovered: 0,
};

const DEFAULT_RUNTIME: RuntimeState = {
  providers: { failures: [] },
  locks: { active: 0 },
  cache: { size: 0 },
};

const DEFAULT_DATA: OperationsData = {
  sessions: [],
  backoff: [],
  metrics: { statusByProvider: {} },
  monitor: DEFAULT_MONITOR,
  runtime: DEFAULT_RUNTIME,
  health: { status: "DOWN", timestamp: new Date().toISOString() },
  telemetry: {
    messages: {},
    providers: {},
    registry: {},
    sessionMonitor: { reconnectionAttempts: 0, failovers: 0, recoverySuccess: 0 },
    uptime: 0,
    timestamp: new Date().toISOString(),
  },
};

function coerceData(raw: SessionOperationsPayload): OperationsData {
  return {
    ...DEFAULT_DATA,
    ...raw,
    sessions: Array.isArray(raw?.sessions) ? (raw.sessions as SessionRow[]) : [],
    backoff: Array.isArray(raw?.backoff) ? raw.backoff : [],
    metrics: (raw?.metrics as OperationsData["metrics"]) || DEFAULT_DATA.metrics,
    monitor: (raw?.monitor as MonitorState) || DEFAULT_MONITOR,
    runtime: (raw?.runtime as RuntimeState) || DEFAULT_RUNTIME,
  };
}

function normalizeStatus(status: string) {
  const s = String(status || "").toUpperCase();
  if (s === "WORKING") return "WORKING";
  if (s === "QR") return "QR";
  if (s === "OFFLINE") return "OFFLINE";
  return s || "UNKNOWN";
}

function SocketIndicator({ status, title }: { status: string; title: string }) {
  let color = "#999";
  let label = "Connecting";

  if (status === "connected") {
    color = "green";
    label = "Realtime";
  }

  if (status === "disconnected") {
    color = "orange";
    label = "Offline";
  }

  if (status === "error") {
    color = "red";
    label = "Error";
  }

  if (status === "reconnecting") {
    color = "#f59e0b";
    label = "Reconnecting";
  }

  return (
    <div
      title={title}
      style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "default" }}
    >
      <div style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
      <span>{label}</span>
    </div>
  );
}

export default function SessionOperationsPage() {
  const { status: socketStatus, lastEvent: socketLastEvent } = useSocketStatus();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState<OperationsData>(DEFAULT_DATA);
  const [source, setSource] = useState<"aggregated" | "fallback">("aggregated");
  const [providerFilter, setProviderFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [tenantFilter, setTenantFilter] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<SessionRow | null>(null);
  const [actionLoading, setActionLoading] = useState<string>("");
  const [qrModal, setQrModal] = useState<{ open: boolean; qr: string }>({ open: false, qr: "" });

  const loadData = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await getSessionOperations();
      setData(coerceData(result.data));
      setSource(result.source);
    } catch (e: any) {
      console.error("LOAD_OPERATIONS_FAIL", e);
      setError(e?.message || "Falha ao carregar operação de sessões.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const int = setInterval(() => {
      loadData();
    }, 15000);
    return () => clearInterval(int);
  }, []);

  useEffect(() => {
    const socket = getSocket();
    socket.on("session:connected", loadData);
    socket.on("session:updated", loadData);
    socket.on("session:failover", loadData);
    socket.on("session:qr", (evt: any) => {
      if (!evt?.qr) return;
      setQrModal({ open: true, qr: String(evt.qr) });
      loadData();
    });
    return () => {
      socket.off("session:connected", loadData);
      socket.off("session:updated", loadData);
      socket.off("session:failover", loadData);
      socket.off("session:qr");
    };
  }, []);

  const rows = useMemo(() => {
    const list = data?.sessions || [];
    return list.filter((row) => {
      const providerOk = !providerFilter || row.provider === providerFilter;
      const statusOk = !statusFilter || normalizeStatus(row.status) === statusFilter;
      const tenantOk = !tenantFilter || String(row.tenantId || "").includes(tenantFilter);
      const q = search.trim().toLowerCase();
      const searchOk =
        !q ||
        String(row.channelId || "").toLowerCase().includes(q) ||
        String(row.sessionName || "").toLowerCase().includes(q);
      return providerOk && statusOk && tenantOk && searchOk;
    });
  }, [data?.sessions, providerFilter, statusFilter, tenantFilter, search]);

  const backoffByKey = useMemo(() => {
    const map = new Map<string, { failures: number; nextAllowedAt: number }>();
    for (const b of data?.backoff || []) {
      map.set(b.key, { failures: b.failures, nextAllowedAt: b.nextAllowedAt });
    }
    return map;
  }, [data?.backoff]);

  async function callAction(action: "reconnect" | "refresh" | "qrcode", channelId: string) {
    try {
      setActionLoading(`${action}:${channelId}`);
      const path =
        action === "reconnect"
          ? `/api/sessions/${channelId}/reconnect`
          : action === "refresh"
            ? `/api/sessions/${channelId}/refresh`
            : `/api/sessions/${channelId}/qrcode`;
      const method = action === "qrcode" ? "GET" : "POST";
      const out = await request<any>(path, { method });
      if (action === "qrcode" && out?.qrCode && selected) {
        setSelected({ ...selected, status: "QR" });
      }
      await loadData();
    } catch (e: any) {
      setError(e?.message || "Falha na ação operacional.");
    } finally {
      setActionLoading("");
    }
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Card title="Operação de Sessões">
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <Button onClick={loadData} disabled={loading}>Refresh manual</Button>
          <SocketIndicator status={socketStatus} title={socketLastEvent} />
          <Badge>{(data.health as MessagingHealth | undefined)?.status || "UNKNOWN"}</Badge>
          <span>Uptime: {Math.floor(((data.telemetry as TelemetryResponse | undefined)?.uptime || 0) / 1000)}s</span>
          <span>Sessões: {data.sessions?.length || 0}</span>
          <span>Recoveries: {data.monitor?.lastRecovered || 0}</span>
          <span>Failovers: {(data.telemetry as TelemetryResponse | undefined)?.sessionMonitor?.failovers || 0}</span>
          <span>Locks: {data.runtime?.locks?.active || 0}</span>
          <span>Cache: {data.runtime?.cache?.size || 0}</span>
          {source === "fallback" && (
            <span style={{ color: "orange", fontSize: 12 }}>
              fallback mode
            </span>
          )}
        </div>
        {socketStatus !== "connected" && (
          <div style={{ fontSize: 11, color: "#999", marginTop: 8 }}>
            usando atualização por polling
          </div>
        )}
      </Card>

      <Card title="Filtros">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(180px,1fr))", gap: 12 }}>
          <Input placeholder="Buscar channel/session" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Input placeholder="Tenant" value={tenantFilter} onChange={(e) => setTenantFilter(e.target.value)} />
          <select value={providerFilter} onChange={(e) => setProviderFilter(e.target.value)}>
            <option value="">Todos providers</option>
            <option value="waha">WAHA</option>
            <option value="evolution">Evolution</option>
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">Todos status</option>
            <option value="WORKING">WORKING</option>
            <option value="QR">QR</option>
            <option value="OFFLINE">OFFLINE</option>
          </select>
        </div>
      </Card>

      {error && <Card><span style={{ color: "#b91c1c" }}>{error}</span></Card>}

      <Card title="Sessões Monitoradas">
        <Table>
          <TableHead>
            <tr>
              <th>Tenant</th>
              <th>Channel</th>
              <th>Session</th>
              <th>Provider</th>
              <th>Status</th>
              <th>Backoff</th>
              <th>Ações</th>
            </tr>
          </TableHead>
          <TableBody>
            {rows.map((row) => {
              const key = `${row.provider}:${row.sessionName}`;
              const backoff = backoffByKey.get(key);
              return (
                <TableRow key={`${row.channelId}-${row.sessionName}`} onClick={() => setSelected(row)}>
                  <td>{row.tenantId || "-"}</td>
                  <td>{row.channelId}</td>
                  <td>{row.sessionName}</td>
                  <td>{row.provider}</td>
                  <td>{normalizeStatus(row.status)}</td>
                  <td>{backoff ? `sim (${backoff.failures})` : "não"}</td>
                  <td style={{ display: "flex", gap: 6 }}>
                    <Button
                      variant="secondary"
                      disabled={Boolean(actionLoading)}
                      onClick={(e) => { e.stopPropagation(); callAction("reconnect", row.channelId); }}
                    >
                      Reconnect
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={Boolean(actionLoading)}
                      onClick={(e) => { e.stopPropagation(); callAction("refresh", row.channelId); }}
                    >
                      Refresh
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={Boolean(actionLoading)}
                      onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(row.sessionName).catch(() => {}); }}
                    >
                      Copiar
                    </Button>
                    <Button
                      variant="primary"
                      disabled={Boolean(actionLoading)}
                      onClick={(e) => { e.stopPropagation(); callAction("qrcode", row.channelId); }}
                    >
                      Ver QR
                    </Button>
                  </td>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <Modal open={Boolean(selected)} onClose={() => setSelected(null)} title="Detalhe da Sessão">
        {selected && (
          <div style={{ display: "grid", gap: 8 }}>
            <div><strong>Channel:</strong> {selected.channelId}</div>
            <div><strong>Provider:</strong> {selected.provider}</div>
            <div><strong>Session:</strong> {selected.sessionName}</div>
            <div><strong>Status:</strong> {normalizeStatus(selected.status)}</div>
            <div><strong>Monitor lastRun:</strong> {data.monitor?.lastRunAt || "-"}</div>
            <div><strong>Monitor duration:</strong> {data.monitor?.lastDurationMs || 0}ms</div>
            <div><strong>Provider failures:</strong> {(data.runtime?.providers?.failures || []).length}</div>
            <div><strong>Locks/Cache:</strong> {data.runtime?.locks?.active || 0} / {data.runtime?.cache?.size || 0}</div>
          </div>
        )}
      </Modal>

      <Modal open={qrModal.open} onClose={() => setQrModal({ open: false, qr: "" })} title="QR em tempo real">
        <div style={{ display: "grid", gap: 8 }}>
          <div>QR recebido via WebSocket:</div>
          <Input value={qrModal.qr} readOnly />
        </div>
      </Modal>
    </div>
  );
}
