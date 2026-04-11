import { useMemo, useState } from 'react';
import { mapTenantLimitReason } from '../../utils/mapTenantLimitReason.js';
import { agentApi } from '../../services/agentApi.js';

const overlay = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 400,
  padding: 16,
};

const modal = {
  width: 'min(440px, 100%)',
  borderRadius: 12,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  padding: '1.35rem',
  boxShadow: '0 16px 48px rgba(0,0,0,0.25)',
};

const btnPrimary = {
  flex: 1,
  padding: '10px 14px',
  borderRadius: 8,
  border: 'none',
  background: 'var(--accent)',
  color: '#fff',
  fontWeight: 600,
  cursor: 'pointer',
  fontSize: '0.9rem',
};

const btnSecondary = {
  flex: 1,
  padding: '10px 14px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--text)',
  fontWeight: 600,
  cursor: 'pointer',
  fontSize: '0.9rem',
};

const btnGhost = {
  marginTop: 10,
  width: '100%',
  padding: '8px',
  border: 'none',
  background: 'transparent',
  color: 'var(--text-muted)',
  cursor: 'pointer',
  fontSize: '0.85rem',
};

/** @param {string | null | undefined} currentPlan */
export function defaultUpgradeTargetPlan(currentPlan) {
  const s = String(currentPlan || 'free').toLowerCase();
  if (s.includes('enterprise')) return null;
  if (s.includes('pro')) return 'enterprise';
  return 'pro';
}

/**
 * @param {{
 *   open: boolean,
 *   onClose: () => void,
 *   reason?: string | null,
 *   plan?: string | null,
 *   blockedFeature?: string | null,
 *   onViewPlan?: () => void,
 *   commercialHref?: string,
 *   upgradeTargetPlan?: 'pro' | 'enterprise' | null,
 * }} props
 */
export function UpgradePlanModal({
  open,
  onClose,
  reason,
  plan,
  blockedFeature,
  onViewPlan,
  commercialHref = 'mailto:comercial@omnia1biai.com.br?subject=Upgrade%20de%20plano',
  upgradeTargetPlan,
}) {
  const [upgradeLoading, setUpgradeLoading] = useState(false);
  const [upgradeError, setUpgradeError] = useState(null);

  const targetPlan = useMemo(
    () => (upgradeTargetPlan !== undefined ? upgradeTargetPlan : defaultUpgradeTargetPlan(plan)),
    [upgradeTargetPlan, plan],
  );

  if (!open) return null;

  const description = mapTenantLimitReason(reason);

  async function handlePaidUpgrade() {
    if (!targetPlan) return;
    setUpgradeLoading(true);
    setUpgradeError(null);
    try {
      const data = await agentApi.request('/api/billing/checkout', {
        method: 'POST',
        body: { plan: targetPlan },
      });
      const url = data?.url;
      if (!url) throw new Error('Resposta sem URL de pagamento.');
      window.location.href = url;
    } catch (e) {
      setUpgradeError(e?.message || 'Falha ao iniciar pagamento.');
    } finally {
      setUpgradeLoading(false);
    }
  }

  return (
    <div
      style={overlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="plan-limit-title"
      onClick={onClose}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <h2 id="plan-limit-title" style={{ margin: '0 0 8px', fontSize: '1.15rem', color: 'var(--text)' }}>
          Limite do plano atingido
        </h2>
        <p style={{ margin: '0 0 6px', fontSize: '0.9rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
          {description}
        </p>
        {plan ? (
          <p style={{ margin: '0 0 14px', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Plano atual: <strong style={{ color: 'var(--text)' }}>{plan}</strong>
            {blockedFeature ? ` · ${blockedFeature}` : ''}
          </p>
        ) : (
          <div style={{ height: 8 }} />
        )}
        <p style={{ margin: '0 0 16px', fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.45 }}>
          Faça upgrade para liberar mais recursos e escalar sua operação com suporte dedicado.
        </p>
        {upgradeError ? (
          <p style={{ margin: '0 0 12px', fontSize: '0.82rem', color: '#c0392b' }}>{upgradeError}</p>
        ) : null}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {targetPlan ? (
            <button
              type="button"
              disabled={upgradeLoading}
              style={{ ...btnPrimary, opacity: upgradeLoading ? 0.75 : 1 }}
              onClick={handlePaidUpgrade}
            >
              {upgradeLoading ? 'Redirecionando…' : 'Fazer upgrade'}
            </button>
          ) : null}
          <a
            href={commercialHref}
            style={{ ...btnSecondary, textAlign: 'center', textDecoration: 'none', display: 'inline-block' }}
          >
            Falar com comercial
          </a>
          <button type="button" style={btnSecondary} onClick={() => onViewPlan?.()}>
            Ver plano atual
          </button>
        </div>
        <button type="button" style={btnGhost} onClick={onClose}>
          Entendi
        </button>
      </div>
    </div>
  );
}
