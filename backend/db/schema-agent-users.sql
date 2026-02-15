-- =============================================================================
-- AGENTE IA OMNICANAL - Tabela exclusiva de usuários do painel (isolada do SIS-ACOLHE)
-- =============================================================================

DROP TABLE IF EXISTS agent_users CASCADE;

CREATE TABLE agent_users (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  email      TEXT UNIQUE NOT NULL,
  password   TEXT NOT NULL,
  role       TEXT DEFAULT 'admin',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_users_email ON agent_users(email);
