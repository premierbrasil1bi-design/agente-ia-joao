/**
 * Admin: indicador compacto sem ChannelContext (layout legado).
 */
export function ChannelIndicator({ compact }) {
  if (compact) {
    return (
      <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Painel administrativo</span>
    );
  }
  return null;
}
