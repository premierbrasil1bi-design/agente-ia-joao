import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Badge, Button, Card, Skeleton } from "../../components/ui";
import { adminApi } from "../../api/admin";
import { useAuth } from "../../auth/AuthContext";
import { canReconnectProvider } from "../../utils/rbac";
import ProviderCard from "./ProviderCard";
import styles from "./ProvidersPage.module.css";

const FILTERS = ["all", "ok", "degraded", "down"];
const REFRESH_OPTIONS = [2, 5, 10, 30, 60];
const DEFAULT_REFRESH_SECONDS = 5;

function parseAutoRefresh(rawValue) {
  if (rawValue == null || rawValue === "") return true;
  const v = String(rawValue).toLowerCase();
  if (v === "true") return true;
  if (v === "false") return false;
  return true;
}

function parseRefreshSeconds(rawValue) {
  const n = Number(rawValue);
  if (!Number.isFinite(n)) return DEFAULT_REFRESH_SECONDS;
  const rounded = Math.floor(n);
  if (rounded < 2 || rounded > 60) return DEFAULT_REFRESH_SECONDS;
  return rounded;
}

function computeGlobalStatus(entries) {
  const statuses = entries.map(([, item]) => String(item?.status || "").toLowerCase());
  if (statuses.length === 0) return "ok";
  if (statuses.includes("down")) return "down";
  if (statuses.includes("degraded")) return "degraded";
  return "ok";
}

function badgeVariantForStatus(status) {
  const s = String(status || "").toLowerCase();
  if (s === "ok") return "success";
  if (s === "degraded") return "warning";
  return "danger";
}

export default function ProvidersPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [providers, setProviders] = useState({});
  const [timestamp, setTimestamp] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const statusFromUrl = String(searchParams.get("status") || "all").toLowerCase();
  const initialStatus = FILTERS.includes(statusFromUrl) ? statusFromUrl : "all";
  const initialAutoRefresh = parseAutoRefresh(searchParams.get("autoRefresh"));
  const initialRefreshSeconds = parseRefreshSeconds(searchParams.get("refresh"));
  const [statusFilter, setStatusFilter] = useState(initialStatus);
  const [autoRefresh, setAutoRefresh] = useState(initialAutoRefresh);
  const [refreshSeconds, setRefreshSeconds] = useState(initialRefreshSeconds);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [copied, setCopied] = useState(false);
  const [incidentCopied, setIncidentCopied] = useState(false);
  const [reconnectingProvider, setReconnectingProvider] = useState("");
  const [toast, setToast] = useState(null);
  const allowReconnect = useMemo(() => canReconnectProvider(user), [user]);

  const providerEntries = useMemo(() => Object.entries(providers || {}), [providers]);
  const globalStatus = useMemo(() => computeGlobalStatus(providerEntries), [providerEntries]);
  const filteredEntries = useMemo(
    () =>
      providerEntries.filter(([, item]) => {
        if (statusFilter === "all") return true;
        return String(item?.status || "").toLowerCase() === statusFilter;
      }),
    [providerEntries, statusFilter]
  );
  const counts = useMemo(() => {
    const result = { all: providerEntries.length, ok: 0, degraded: 0, down: 0 };
    for (const [, item] of providerEntries) {
      const s = String(item?.status || "").toLowerCase();
      if (s === "ok" || s === "degraded" || s === "down") result[s] += 1;
    }
    return result;
  }, [providerEntries]);
  const hasDownProvider = counts.down > 0;

  useEffect(() => {
    const fromUrl = String(searchParams.get("status") || "all").toLowerCase();
    const next = FILTERS.includes(fromUrl) ? fromUrl : "all";
    setStatusFilter((current) => (current === next ? current : next));
    const nextAuto = parseAutoRefresh(searchParams.get("autoRefresh"));
    const nextRefresh = parseRefreshSeconds(searchParams.get("refresh"));
    setAutoRefresh((current) => (current === nextAuto ? current : nextAuto));
    setRefreshSeconds((current) => (current === nextRefresh ? current : nextRefresh));
  }, [searchParams]);

  const updateUrlState = useCallback(
    (next) => {
      const normalizedStatus = FILTERS.includes(String(next.status || statusFilter))
        ? String(next.status || statusFilter)
        : "all";
      const normalizedAuto = typeof next.autoRefresh === "boolean" ? next.autoRefresh : autoRefresh;
      const normalizedRefresh = parseRefreshSeconds(next.refresh ?? refreshSeconds);
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set("status", normalizedStatus);
      nextParams.set("autoRefresh", String(normalizedAuto));
      nextParams.set("refresh", String(normalizedRefresh));
      setSearchParams(nextParams);
    },
    [searchParams, setSearchParams, statusFilter, autoRefresh, refreshSeconds]
  );

  const setFilterAndUrl = useCallback(
    (nextStatus) => {
      const normalized = FILTERS.includes(nextStatus) ? nextStatus : "all";
      setStatusFilter(normalized);
      updateUrlState({ status: normalized });
    },
    [updateUrlState]
  );

  const setAutoRefreshAndUrl = useCallback(
    (value) => {
      const normalized = Boolean(value);
      setAutoRefresh(normalized);
      updateUrlState({ autoRefresh: normalized });
    },
    [updateUrlState]
  );

  const setRefreshSecondsAndUrl = useCallback(
    (value) => {
      const normalized = parseRefreshSeconds(value);
      setRefreshSeconds(normalized);
      updateUrlState({ refresh: normalized });
    },
    [updateUrlState]
  );

  const copyToClipboard = useCallback(async (text, onSuccess) => {
    try {
      await navigator.clipboard.writeText(text);
      onSuccess?.();
      return;
    } catch {
      // fallback
    }

    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      ta.style.left = "-1000px";
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      if (ok) onSuccess?.();
    } catch {
      // sem feedback de erro para manter UX simples
    }
  }, []);

  const copyCurrentViewLink = useCallback(async () => {
    const currentUrl = window.location.href;
    await copyToClipboard(currentUrl, () => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  }, [copyToClipboard]);

  const copyIncidentViewLink = useCallback(async () => {
    const params = new URLSearchParams(searchParams);
    params.set("status", "down");
    params.set("autoRefresh", "true");
    params.set("refresh", "2");
    const url = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
    await copyToClipboard(url, () => {
      setIncidentCopied(true);
      window.setTimeout(() => setIncidentCopied(false), 2000);
    });
  }, [copyToClipboard, searchParams]);

  const showToast = useCallback((type, message) => {
    setToast({ type, message });
    window.setTimeout(() => setToast(null), 2500);
  }, []);

  const handleReconnect = useCallback(
    async (providerName) => {
      setReconnectingProvider(providerName);
      try {
        const out = await adminApi.reconnectProvider(providerName);
        showToast("success", out?.message || "Reconexão iniciada");
        await loadProviders({ silent: true });
      } catch (e) {
        showToast("error", e?.message || "Falha ao iniciar reconexão");
      } finally {
        setReconnectingProvider("");
      }
    },
    [loadProviders, showToast]
  );

  const loadProviders = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else setLoading(true);

    try {
      setError("");
      const data = await adminApi.getProvidersHealth();
      setProviders(data?.providers || {});
      setTimestamp(data?.timestamp || new Date().toISOString());
    } catch (e) {
      setError(e?.message || "Falha ao carregar status dos providers.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadProviders();
  }, [loadProviders]);

  useEffect(() => {
    if (!autoRefresh) return undefined;
    const interval = setInterval(() => {
      loadProviders({ silent: true });
    }, refreshSeconds * 1000);
    return () => clearInterval(interval);
  }, [loadProviders, autoRefresh, refreshSeconds]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (!timestamp) {
        setElapsedSeconds(0);
        return;
      }
      const diff = Math.max(0, Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000));
      setElapsedSeconds(diff);
    }, 1000);
    return () => clearInterval(interval);
  }, [timestamp]);

  return (
    <div className={styles.page}>
      <Card>
        <div className={styles.headerRow}>
          <div>
            <h2 className={styles.title}>Providers Monitor</h2>
            <p className={styles.subtitle}>Status operacional em tempo real dos providers de canais.</p>
          </div>
          <Button onClick={() => loadProviders({ silent: true })} disabled={refreshing}>
            {refreshing ? "Atualizando..." : "Atualizar agora"}
          </Button>
          <Button
            variant="secondary"
            onClick={copyCurrentViewLink}
            aria-label="Copiar link da visão atual"
            title="Copiar link da visão atual"
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <span aria-hidden>{copied ? "✓" : "🔗"}</span>
              <span>{copied ? "Copiado!" : "Copiar link"}</span>
            </span>
          </Button>
          {hasDownProvider ? (
            <Button
              variant="secondary"
              onClick={copyIncidentViewLink}
              aria-label="Compartilhar incidente"
              title="Compartilhar incidente"
            >
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                <span aria-hidden>{incidentCopied ? "✓" : "🚨"}</span>
                <span>{incidentCopied ? "Copiado!" : "Compartilhar incidente"}</span>
              </span>
            </Button>
          ) : null}
        </div>
        <div className={styles.metaRow}>
          <p className={styles.updatedAt}>
            Última atualização: {timestamp ? `${elapsedSeconds}s atrás` : "—"}
          </p>
          <Badge variant={badgeVariantForStatus(globalStatus)}>
            Status global: {String(globalStatus || "ok").toUpperCase()}
          </Badge>
        </div>
        <div className={styles.filtersRow}>
          {FILTERS.map((f) => {
            const active = statusFilter === f;
            return (
              <button
                key={f}
                type="button"
                onClick={() => setFilterAndUrl(f)}
                className={`${styles.filterBtn} ${active ? styles.filterBtnActive : ""}`}
              >
                {f === "all"
                  ? `Todos (${counts.all})`
                  : f === "ok"
                    ? `OK (${counts.ok})`
                    : f === "degraded"
                      ? `Degraded (${counts.degraded})`
                      : `Down (${counts.down})`}
              </button>
            );
          })}
        </div>
        <div className={styles.controlsRow}>
          <label className={styles.controlItem}>
            <span>Auto Refresh</span>
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefreshAndUrl(e.target.checked)}
            />
          </label>
          <label className={styles.controlItem}>
            <span>Intervalo</span>
            <select
              value={String(refreshSeconds)}
              onChange={(e) => setRefreshSecondsAndUrl(Number(e.target.value))}
              disabled={!autoRefresh}
              className={styles.select}
            >
              {REFRESH_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}s
                </option>
              ))}
            </select>
          </label>
        </div>
      </Card>

      {error ? (
        <Card className={styles.errorCard}>
          <p className={styles.errorText}>{error}</p>
        </Card>
      ) : null}

      {loading ? (
        <div className={styles.grid}>
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={`s-${i}`}>
              <Skeleton width="40%" height={20} />
              <div className={styles.skeletonRows}>
                <Skeleton width="100%" height={14} />
                <Skeleton width="88%" height={14} />
                <Skeleton width="70%" height={14} />
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <div className={styles.grid}>
          {filteredEntries.length === 0 ? (
            <Card>
              <p className={styles.emptyText}>
                {providerEntries.length === 0
                  ? "Nenhum provider retornado pela API."
                  : "Nenhum provider corresponde ao filtro selecionado."}
              </p>
            </Card>
          ) : (
            filteredEntries.map(([name, item]) => (
              <ProviderCard
                key={name}
                name={name}
                status={item?.status}
                latency={item?.latencyMs ?? null}
                failures={item?.consecutiveFailures ?? 0}
                lastCheckAt={item?.lastCheckAt ?? null}
                retryCount={item?.retryCount ?? 0}
                nextRetryInMs={item?.nextRetryInMs ?? null}
                lastAutoReconnectAt={item?.lastAutoReconnectAt ?? null}
                message={item?.message ?? null}
                reconnecting={reconnectingProvider === name}
                onReconnect={handleReconnect}
                canReconnect={allowReconnect}
              />
            ))
          )}
        </div>
      )}
      {toast ? (
        <div className={`${styles.toast} ${toast.type === "error" ? styles.toastError : styles.toastSuccess}`}>
          {toast.message}
        </div>
      ) : null}
    </div>
  );
}
