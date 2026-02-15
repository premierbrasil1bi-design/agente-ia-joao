import { Routes, Route, Link, Navigate, useLocation } from 'react-router-dom';
import { TopBar } from './components/TopBar';
import { ChannelIndicator } from './components/ChannelIndicator';
import { Dashboard } from './pages/Dashboard';
import { ContextoAgente } from './pages/ContextoAgente';
import { Prompts } from './pages/Prompts';
import { Agentes } from './pages/Agentes';
import { Login } from './pages/Login';
import { useAgentAuth } from './context/AgentAuthContext';

function Layout({ children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <TopBar />
      <div style={{ display: 'flex', flex: 1 }}>
        <aside
          style={{
            width: 220,
            background: 'var(--surface)',
            borderRight: '1px solid var(--border)',
            padding: '1rem 0',
          }}
        >
          <div style={{ padding: '0 1rem 0.75rem', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
            PAINEL
          </div>
          <nav>
            <Link to="/" style={linkStyle}>Dashboard</Link>
            <Link to="/contexto" style={linkStyle}>Contexto do Agente</Link>
            <Link to="/prompts" style={linkStyle}>Prompts</Link>
            <Link to="/agentes" style={linkStyle}>Agentes</Link>
            <Link to="/canais" style={linkStyle}>Canais</Link>
          </nav>
          <div style={{ padding: '1rem 1rem 0', borderTop: '1px solid var(--border)', marginTop: '0.5rem' }}>
            <ChannelIndicator compact />
          </div>
        </aside>
        <main style={{ flex: 1, padding: '1.5rem 2rem', overflow: 'auto' }}>
          {children}
        </main>
      </div>
    </div>
  );
}

const linkStyle = {
  display: 'block',
  padding: '0.5rem 1rem',
  color: 'var(--text)',
  textDecoration: 'none',
  fontSize: '0.9rem',
};

/** Redireciona para /login se agent_token não existir (AGENTE IA OMNICANAL). */
function RequireAuth({ children }) {
  const { isAuthenticated } = useAgentAuth();
  const location = useLocation();
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <Layout>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/contexto" element={<ContextoAgente />} />
                <Route path="/prompts" element={<Prompts />} />
                <Route path="/agentes" element={<Agentes />} />
                <Route path="/canais" element={<div><h2>Canais</h2><p>Lista e status dos canais (em evolução).</p></div>} />
              </Routes>
            </Layout>
          </RequireAuth>
        }
      />
    </Routes>
  );
}
