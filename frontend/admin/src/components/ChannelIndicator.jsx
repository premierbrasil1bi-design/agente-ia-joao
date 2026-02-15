/**
 * Indicador obrigatório: "Canal ativo: X"
 * Exibido no frontend e enviado em todas as requisições da API.
 */

import { useChannel } from '../context/ChannelContext';

export function ChannelIndicator({ compact }) {
  const { channel, setChannel, canaisDisponiveis } = useChannel();
  const label = channel.toUpperCase();

  if (compact) {
    return (
      <span
        style={{
          fontSize: '0.85rem',
          color: 'var(--accent)',
          fontWeight: 600,
        }}
      >
        Canal ativo: {label}
      </span>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        padding: '0.5rem 0.75rem',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 6,
      }}
    >
      <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
        Canal ativo:
      </span>
      <select
        value={channel}
        onChange={(e) => setChannel(e.target.value)}
        style={{
          background: 'var(--bg)',
          color: 'var(--text)',
          border: '1px solid var(--border)',
          borderRadius: 4,
          padding: '0.25rem 0.5rem',
          fontWeight: 600,
        }}
      >
        {canaisDisponiveis.map((c) => (
          <option key={c} value={c}>
            {c.toUpperCase()}
          </option>
        ))}
      </select>
    </div>
  );
}
