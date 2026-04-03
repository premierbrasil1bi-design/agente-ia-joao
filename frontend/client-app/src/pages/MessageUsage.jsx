import { useCallback, useEffect, useMemo, useState } from 'react';
import { getTenantUsage } from '../services/tenantUsage.service.js';
import styles from './MessageUsage.module.css';

const UPGRADE_HREF =
  import.meta.env.VITE_UPGRADE_URL || 'mailto:contato@omnia1biai.com.br?subject=Upgrade%20de%20plano';

function planBadgeClass(plan) {
  const p = String(plan || '').toLowerCase();
  if (p === 'enterprise') return styles.planBadgeEnterprise;
  if (p === 'free' || p === '') return styles.planBadgeFree;
  return '';
}

function planLabel(plan) {
  const p = String(plan || 'free').toLowerCase();
  if (p === 'enterprise') return 'Enterprise';
  if (p === 'pro') return 'Pro';
  if (p === 'free') return 'Free';
  return plan ? String(plan) : 'Free';
}

function formatCycleStart(iso) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return null;
  }
}

export function MessageUsage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getTenantUsage();
      setData(res);
    } catch (e) {
      setError(e?.message || 'Não foi possível carregar o uso de mensagens.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const stats = useMemo(() => {
    if (!data) return null;
    const used = Math.max(0, Number(data.messages_used_success ?? 0));
    const unlimited = Boolean(data.unlimited);
    const max = data.max_messages != null ? Number(data.max_messages) : null;
    const remaining =
      data.messages_remaining != null ? Math.max(0, Number(data.messages_remaining)) : null;

    let pct = null;
    if (!unlimited && max != null && Number.isFinite(max) && max > 0) {
      pct = (used / max) * 100;
    }

    return { used, unlimited, max, remaining, pct };
  }, [data]);

  const progressWidth = useMemo(() => {
    if (!stats || stats.unlimited || stats.pct == null) return 0;
    return Math.min(100, stats.pct);
  }, [stats]);

  const progressClass = useMemo(() => {
    if (!stats || stats.unlimited || stats.pct == null) return styles.progressFill;
    if (stats.pct > 100) return `${styles.progressFill} ${styles.progressFillDanger} ${styles.progressOver}`;
    if (stats.pct > 80) return `${styles.progressFill} ${styles.progressFillWarn}`;
    return styles.progressFill;
  }, [stats]);

  const showWarning = stats && !stats.unlimited && stats.pct != null && stats.pct > 80 && stats.pct <= 100;
  const showOverLimit = stats && !stats.unlimited && stats.pct != null && stats.pct > 100;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>Uso de mensagens</h1>
        <p>
          Acompanhe o consumo do período de faturamento atual
          {data?.billing_cycle_start && (
            <>
              {' '}
              · Início do ciclo: <strong style={{ color: 'var(--text)' }}>{formatCycleStart(data.billing_cycle_start)}</strong>
            </>
          )}
        </p>
      </header>

      {loading && <div className={styles.loading}>Carregando…</div>}

      {error && (
        <div className={styles.error}>
          {error}
          <div>
            <button type="button" className={styles.retryBtn} onClick={load}>
              Tentar novamente
            </button>
          </div>
        </div>
      )}

      {!loading && !error && data && stats && (
        <section className={styles.card} aria-labelledby="usage-heading">
          <div className={styles.cardHead}>
            <h2 id="usage-heading" className={styles.srOnly}>
              Resumo de uso
            </h2>
            <span
              className={`${styles.planBadge} ${planBadgeClass(data.plan)}`}
              title="Plano contratado"
            >
              Plano {planLabel(data.plan)}
            </span>
          </div>

          {showWarning && (
            <div className={`${styles.alert} ${styles.alertWarning}`} role="status">
              <div>
                <strong>Atenção: uso elevado</strong>
                Você já utilizou mais de 80% do pacote de mensagens deste ciclo. Considere ajustar o uso ou
                fazer upgrade antes de atingir o limite.
              </div>
            </div>
          )}

          {showOverLimit && (
            <div className={`${styles.alert} ${styles.alertError}`} role="alert">
              <div>
                <strong>Limite do período excedido</strong>
                O envio de novas mensagens pode estar bloqueado até o próximo ciclo ou upgrade de plano.
                <div className={styles.alertActions}>
                  <a className={styles.btnUpgrade} href={UPGRADE_HREF} target="_blank" rel="noopener noreferrer">
                    Falar sobre upgrade
                  </a>
                </div>
              </div>
            </div>
          )}

          {stats.unlimited ? (
            <>
              <p className={styles.summaryText}>
                <em>{stats.used.toLocaleString('pt-BR')}</em> mensagens utilizadas neste ciclo
              </p>
              <p className={styles.unlimitedNote}>
                Seu plano atual não possui limite rígido de mensagens. Os números refletem apenas o volume
                registrado no período.
              </p>
            </>
          ) : (
            <>
              <p className={styles.summaryText}>
                <em>{stats.used.toLocaleString('pt-BR')}</em> de{' '}
                <em>{stats.max != null ? stats.max.toLocaleString('pt-BR') : '—'}</em> mensagens utilizadas
              </p>

              <div className={styles.progressTrack} aria-hidden={stats.pct == null}>
                <div className={progressClass} style={{ width: `${progressWidth}%` }} />
              </div>

              <div className={styles.metaRow}>
                <span>
                  Utilização:{' '}
                  <strong>
                    {stats.pct != null ? `${stats.pct.toFixed(1).replace(/\.0$/, '')}%` : '—'}
                  </strong>
                </span>
                <span>
                  Restante:{' '}
                  <strong>
                    {stats.remaining != null ? stats.remaining.toLocaleString('pt-BR') : '—'}
                  </strong>
                </span>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
