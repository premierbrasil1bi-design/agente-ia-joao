/**
 * Barra superior fixa: nome do produto + "Canal ativo: X" + seletor de canal + admin + logout.
 */

import { useNavigate } from 'react-router-dom';
import { useChannel } from '../context/ChannelContext';
import { useAgentAuth } from '../context/AgentAuthContext';
import { ChannelIndicator } from './ChannelIndicator';

const styles = {
  bar: {
    position: 'sticky',
    top: 0,
    zIndex: 100,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '1rem',
    padding: '0.5rem 1.5rem',
    background: 'var(--surface)',
    borderBottom: '1px solid var(--border)',
    flexWrap: 'wrap',
  },
  product: {
    fontSize: '1.1rem',
    fontWeight: 700,
    color: 'var(--text)',
  },
  right: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
  },
  canalLabel: {
    fontSize: '0.85rem',
    color: 'var(--text-muted)',
    fontWeight: 600,
  },
  canalValue: {
    fontSize: '0.9rem',
    color: 'var(--accent)',
    fontWeight: 700,
  },
};

export function TopBar() {
  const { channel } = useChannel();
  const { agent, logout } = useAgentAuth();
  const navigate = useNavigate();
  const label = channel.toUpperCase();

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <header style={styles.bar}>
      <span style={styles.product}>Agent Admin</span>
      <div style={styles.right}>
        <span style={styles.canalLabel}>Canal ativo:</span>
        <span style={styles.canalValue}>{label}</span>
        <ChannelIndicator />
        {agent?.name && (
          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{agent.name}</span>
        )}
        <button
          type="button"
          onClick={handleLogout}
          style={{
            padding: '0.35rem 0.75rem',
            fontSize: '0.85rem',
            background: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: 6,
            color: 'var(--text-muted)',
            cursor: 'pointer',
          }}
        >
          Sair
        </button>
      </div>
    </header>
  );
}
