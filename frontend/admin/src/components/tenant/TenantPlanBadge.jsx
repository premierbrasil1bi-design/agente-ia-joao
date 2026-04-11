const planStyles = {
  free: { bg: 'rgba(110,118,129,0.2)', border: '1px solid var(--border)', color: 'var(--text-muted)' },
  pro: { bg: 'rgba(88,166,255,0.15)', border: '1px solid var(--accent)', color: 'var(--accent)' },
  enterprise: { bg: 'rgba(163,113,247,0.15)', border: '1px solid #a371f7', color: '#a371f7' },
};

function normalizePlanKey(plan) {
  const p = String(plan || 'free').toLowerCase().trim();
  if (p.includes('enterprise')) return 'enterprise';
  if (p.includes('pro')) return 'pro';
  return 'free';
}

function labelFor(planKey) {
  if (planKey === 'enterprise') return 'Enterprise';
  if (planKey === 'pro') return 'Pro';
  return 'Free';
}

/**
 * @param {{ plan?: string | null, compact?: boolean }} props
 */
export function TenantPlanBadge({ plan, compact }) {
  const key = normalizePlanKey(plan);
  const st = planStyles[key] || planStyles.free;
  return (
    <span
      title={`Plano: ${labelFor(key)}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: compact ? '2px 8px' : '4px 10px',
        borderRadius: 999,
        fontSize: compact ? '0.7rem' : '0.75rem',
        fontWeight: 700,
        letterSpacing: '0.02em',
        textTransform: 'uppercase',
        ...st,
      }}
    >
      {labelFor(key)}
    </span>
  );
}
