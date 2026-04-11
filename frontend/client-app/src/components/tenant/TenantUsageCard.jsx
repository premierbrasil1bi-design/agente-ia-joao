function UsageRow({ label, used, max }) {
  const u = Number(used) || 0;
  const hasCap = max != null && Number.isFinite(Number(max)) && Number(max) > 0;
  const cap = hasCap ? Number(max) : null;
  const pct = hasCap ? Math.min(100, Math.round((u / cap) * 100)) : null;

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: 4 }}>
        <span style={{ color: 'var(--text-muted)' }}>{label}</span>
        <span style={{ color: 'var(--text)', fontWeight: 600 }}>
          {u}
          {hasCap ? ` / ${cap}` : max == null ? ' / ∞' : ''}
        </span>
      </div>
      {hasCap ? (
        <div style={{ height: 6, borderRadius: 4, background: 'var(--border)', overflow: 'hidden' }}>
          <div
            style={{
              height: '100%',
              width: `${pct}%`,
              borderRadius: 4,
              background: pct >= 90 ? 'var(--danger, #f85149)' : 'var(--accent)',
              transition: 'width 0.2s ease',
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

export function TenantUsageCard({ plan, limits = {}, usage = {}, features = {}, loading, id }) {
  if (loading) {
    return (
      <div
        id={id}
        style={{
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: '1rem',
          background: 'var(--surface)',
          color: 'var(--text-muted)',
        }}
      >
        Carregando uso do plano…
      </div>
    );
  }

  const ch = usage.channels ?? 0;
  const ag = usage.agents ?? 0;
  const msg = usage.messages ?? 0;
  const rt = Boolean(features.realtimeMonitoring);

  return (
    <div
      id={id}
      style={{
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '1rem 1.1rem',
        background: 'var(--surface)',
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 12, color: 'var(--text)' }}>Seu plano</div>
      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 16 }}>
        Plano atual: <strong style={{ color: 'var(--text)' }}>{String(plan || 'free')}</strong>
      </div>

      <UsageRow label="Canais" used={ch} max={limits.maxChannels} />
      <UsageRow label="Agentes" used={ag} max={limits.maxAgents} />
      <UsageRow label="Mensagens (período)" used={msg} max={limits.maxMessages} />

      <div
        style={{
          marginTop: 8,
          paddingTop: 12,
          borderTop: '1px solid var(--border)',
          fontSize: '0.85rem',
          color: 'var(--text-muted)',
        }}
      >
        Monitoramento em tempo real:{' '}
        <strong style={{ color: rt ? 'var(--success, #3fb950)' : 'var(--text-muted)' }}>
          {rt ? 'Incluído' : 'Não incluído'}
        </strong>
      </div>
    </div>
  );
}
