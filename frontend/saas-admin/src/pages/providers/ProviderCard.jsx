import { useEffect, useRef, useState } from "react";
import { Badge, Card } from "../../components/ui";
import styles from "./ProviderCard.module.css";

function getStatusMeta(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "ok") return { label: "OK", emoji: "🟢", variant: "success" };
  if (normalized === "degraded") return { label: "DEGRADED", emoji: "🟡", variant: "warning" };
  return { label: "DOWN", emoji: "🔴", variant: "danger" };
}

function formatDate(value) {
  if (!value) return "—";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleString("pt-BR");
}

function formatMs(ms) {
  if (ms == null || !Number.isFinite(Number(ms))) return "—";
  const total = Math.max(0, Math.floor(Number(ms)));
  if (total < 1000) return `${total}ms`;
  const sec = Math.floor(total / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  if (min < 60) return `${min}m ${remSec}s`;
  const h = Math.floor(min / 60);
  const remMin = min % 60;
  return `${h}h ${remMin}m`;
}

function formatCountdown(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) return "agora";
  const totalSec = Math.floor(value / 1000);
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec % 60;
  const mmTxt = String(mm).padStart(2, "0");
  const ssTxt = String(ss).padStart(2, "0");
  return `${mmTxt}:${ssTxt}`;
}

function timeAgo(timestamp) {
  if (!timestamp) return "—";
  const ts = new Date(timestamp).getTime();
  if (Number.isNaN(ts)) return "—";
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return `${diffSec}s atrás`;
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min}m atrás`;
  const h = Math.floor(min / 60);
  const remMin = min % 60;
  return `${h}h ${remMin}m atrás`;
}

function statusSymbol(status) {
  const s = String(status || "").toLowerCase();
  if (s === "down") return "↓";
  if (s === "ok") return "↑";
  return "→";
}

function playDownAlertSound() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.value = 0.0001;
    osc.connect(gain);
    gain.connect(ctx.destination);
    const now = ctx.currentTime;
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    osc.start(now);
    osc.stop(now + 0.22);
    window.setTimeout(() => ctx.close(), 260);
  } catch {
    // best-effort
  }
}

export default function ProviderCard({
  name,
  status,
  latency,
  failures,
  lastCheckAt,
  message,
  reconnecting = false,
  onReconnect,
  canReconnect = true,
  retryCount = 0,
  nextRetryInMs = null,
  lastAutoReconnectAt = null,
}) {
  const meta = getStatusMeta(status);
  const isDown = String(status || "").toLowerCase() === "down";
  const showRetryInfo = Number(retryCount || 0) > 0;
  const [statusHistory, setStatusHistory] = useState([]);
  const [flashDown, setFlashDown] = useState(false);
  const previousStatusRef = useRef(String(status || "").toLowerCase());
  const soundArmedRef = useRef(true);
  const [remainingMs, setRemainingMs] = useState(() => {
    const n = Number(nextRetryInMs);
    return Number.isFinite(n) && n > 0 ? n : 0;
  });

  useEffect(() => {
    const n = Number(nextRetryInMs);
    setRemainingMs(Number.isFinite(n) && n > 0 ? n : 0);
  }, [nextRetryInMs]);

  useEffect(() => {
    if (remainingMs <= 0) return undefined;
    const id = window.setInterval(() => {
      setRemainingMs((prev) => {
        const next = prev - 1000;
        return next > 0 ? next : 0;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [remainingMs]);
  const isRetrySoon = remainingMs > 0 && remainingMs < 10_000;

  useEffect(() => {
    const current = String(status || "").toLowerCase();
    const previous = previousStatusRef.current;
    if (current === previous) return;

    setStatusHistory((prev) => {
      const next = [{ status: current, at: new Date().toISOString() }, ...prev];
      return next.slice(0, 5);
    });

    if (current === "down") {
      setFlashDown(true);
      window.setTimeout(() => setFlashDown(false), 700);
      if (soundArmedRef.current) {
        playDownAlertSound();
        soundArmedRef.current = false;
      }
    }
    if (current === "ok") {
      soundArmedRef.current = true;
    }
    previousStatusRef.current = current;
  }, [status]);

  return (
    <Card className={`${styles.card} ${isDown ? styles.downCard : ""} ${flashDown ? styles.downFlash : ""}`}>
      <div className={styles.headerRow}>
        <h3 className={styles.title}>{String(name || "provider").toUpperCase()}</h3>
        <Badge variant={meta.variant}>{`${meta.emoji} ${meta.label}`}</Badge>
      </div>

      <dl className={styles.meta}>
        <div className={styles.row}>
          <dt>Latência</dt>
          <dd>{latency == null ? "—" : `${latency}ms`}</dd>
        </div>
        <div className={styles.row}>
          <dt>Falhas consecutivas</dt>
          <dd>{typeof failures === "number" ? failures : 0}</dd>
        </div>
        <div className={styles.row}>
          <dt>Última verificação</dt>
          <dd>{formatDate(lastCheckAt)}</dd>
        </div>
      </dl>

      {message ? <p className={styles.message}>{message}</p> : null}

      {statusHistory.length > 0 ? (
        <div className={styles.history}>
          <p className={styles.historyTitle}>Histórico</p>
          <ul className={styles.historyList}>
            {statusHistory.map((ev, idx) => (
              <li key={`${ev.status}-${ev.at}-${idx}`} className={styles.historyItem}>
                <span className={styles.historySymbol}>{statusSymbol(ev.status)}</span>
                <span className={styles.historyStatus}>{String(ev.status || "").toUpperCase()}</span>
                <span className={styles.historyTime}>{timeAgo(ev.at)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {showRetryInfo ? (
        <div className={styles.retryInfo}>
          <Badge variant="info">🤖 Auto-healing ativo</Badge>
          <dl className={styles.retryMeta}>
            <div className={styles.row}>
              <dt>Retries</dt>
              <dd>{retryCount}</dd>
            </div>
            <div className={styles.row}>
              <dt>Próximo retry</dt>
              <dd className={isRetrySoon ? styles.retrySoon : ""}>{formatCountdown(remainingMs) || formatMs(nextRetryInMs)}</dd>
            </div>
            <div className={styles.row}>
              <dt>Último auto-reconnect</dt>
              <dd>{timeAgo(lastAutoReconnectAt)}</dd>
            </div>
          </dl>
        </div>
      ) : null}

      {canReconnect ? (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.reconnectBtn}
            onClick={() => onReconnect && onReconnect(name)}
            disabled={reconnecting}
            aria-label={`Reconectar provider ${String(name || "").toUpperCase()}`}
            title={`Reconectar provider ${String(name || "").toUpperCase()}`}
          >
            {reconnecting ? "⏳ Reconectando..." : "Reconectar"}
          </button>
        </div>
      ) : null}
    </Card>
  );
}
