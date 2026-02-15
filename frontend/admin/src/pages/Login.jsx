/**
 * Login AGENTE IA OMNICANAL – POST /api/agent/auth/login.
 * Salva SOMENTE: agent_token e agent_user no LocalStorage (isolado do SIS-ACOLHE).
 */

import { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAgentAuth } from '../context/AgentAuthContext';
import { agentApi } from '../services/agentApi';

export function Login() {
  const { isAuthenticated, login } = useAgentAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('admin@exemplo.com');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { token, agent } = await agentApi.login(email, password);
      localStorage.setItem('agent_token', token);
      localStorage.setItem('agent_user', JSON.stringify(agent));
      login(token, agent);
      setTimeout(() => navigate('/', { replace: true }), 0);
    } catch (err) {
      setError(err.message || 'Email ou senha inválidos.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg, #0f1419)',
        padding: '1rem',
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          width: '100%',
          maxWidth: 360,
          background: 'var(--surface, #1a2332)',
          border: '1px solid var(--border, #2d3a4f)',
          borderRadius: 12,
          padding: '2rem',
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
        }}
      >
        <h1 style={{ margin: '0 0 0.5rem', fontSize: '1.5rem', color: 'var(--text)' }}>
          Agente IA Omnicanal
        </h1>
        <p style={{ margin: '0 0 1.5rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
          Faça login para acessar o dashboard.
        </p>

        {error && (
          <div
            style={{
              marginBottom: '1rem',
              padding: '0.75rem 1rem',
              background: 'rgba(220,53,69,0.15)',
              border: '1px solid var(--danger)',
              borderRadius: 8,
              color: 'var(--danger)',
              fontSize: '0.9rem',
            }}
          >
            {error}
          </div>
        )}

        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          Email
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '0.75rem 1rem',
            marginBottom: '1rem',
            border: '1px solid var(--border)',
            borderRadius: 8,
            background: 'var(--bg)',
            color: 'var(--text)',
            fontSize: '1rem',
          }}
        />

        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          Senha
        </label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          autoComplete="current-password"
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '0.75rem 1rem',
            marginBottom: '1.5rem',
            border: '1px solid var(--border)',
            borderRadius: 8,
            background: 'var(--bg)',
            color: 'var(--text)',
            fontSize: '1rem',
          }}
        />

        <button
          type="submit"
          disabled={loading}
          style={{
            width: '100%',
            padding: '0.75rem 1rem',
            background: 'var(--accent)',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontSize: '1rem',
            fontWeight: 600,
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? 'Entrando...' : 'Entrar'}
        </button>

        <p style={{ marginTop: '1rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          Email: <strong>admin@exemplo.com</strong> — Senha: a definida ao rodar no backend
          <br />
          <code style={{ fontSize: '0.7rem' }}>node scripts/seed-agent-user.js admin123</code>
        </p>
      </form>
    </div>
  );
}
