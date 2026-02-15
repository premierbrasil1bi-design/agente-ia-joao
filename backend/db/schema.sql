-- =============================================================================
-- Neon (PostgreSQL) - Omni-Channel Agent schema
-- Multi-tenant, multi-agent. Idempotent, run on empty DB.
-- Order: admins, clients, agents, channels, prompts, messages, costs
-- =============================================================================

-- Drop in reverse dependency order (clean run when structure changed)
DROP TABLE IF EXISTS costs CASCADE;
DROP TABLE IF EXISTS messages CASCADE;
DROP TABLE IF EXISTS prompts CASCADE;
DROP TABLE IF EXISTS channels CASCADE;
DROP TABLE IF EXISTS agents CASCADE;
DROP TABLE IF EXISTS clients CASCADE;
DROP TABLE IF EXISTS admins CASCADE;

-- 1. Admins (no FK)
CREATE TABLE IF NOT EXISTS admins (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  name          VARCHAR(255),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admins_email ON admins(email);

-- 2. Clients (no FK)
CREATE TABLE IF NOT EXISTS clients (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR(255) NOT NULL,
  slug       VARCHAR(100) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Agents (FK clients)
CREATE TABLE IF NOT EXISTS agents (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id  UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name       VARCHAR(255) NOT NULL,
  slug       VARCHAR(100) NOT NULL,
  status     VARCHAR(20) NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'inativo', 'erro')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(client_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_agents_client_id ON agents(client_id);

-- 4. Channels (FK agents)
CREATE TABLE IF NOT EXISTS channels (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  name          VARCHAR(100) NOT NULL,
  type          VARCHAR(50) NOT NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'offline' CHECK (status IN ('online', 'offline')),
  is_active     BOOLEAN NOT NULL DEFAULT true,
  message_count INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_channels_agent_id ON channels(agent_id);

-- 5. Prompts (FK agents, FK channels)
CREATE TABLE IF NOT EXISTS prompts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id   UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  channel_id UUID REFERENCES channels(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prompts_agent_id ON prompts(agent_id);
CREATE INDEX IF NOT EXISTS idx_prompts_channel_id ON prompts(channel_id);

-- 6. Messages (FK agents, FK channels)
CREATE TABLE IF NOT EXISTS messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id   UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  channel_id UUID REFERENCES channels(id) ON DELETE SET NULL,
  role       VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_agent_id ON messages(agent_id);
CREATE INDEX IF NOT EXISTS idx_messages_channel_id ON messages(channel_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);

-- 7. Costs (FK agents, FK channels)
CREATE TABLE IF NOT EXISTS costs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  channel_id  UUID REFERENCES channels(id) ON DELETE SET NULL,
  amount      DECIMAL(12, 4) NOT NULL,
  period      VARCHAR(20) NOT NULL CHECK (period IN ('day', 'week', 'month')),
  recorded_at DATE NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_costs_agent_id ON costs(agent_id);
CREATE INDEX IF NOT EXISTS idx_costs_recorded_at ON costs(recorded_at);

-- Function for updated_at (used by triggers)
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers updated_at (idempotent)
DROP TRIGGER IF EXISTS admins_updated_at ON admins;
CREATE TRIGGER admins_updated_at BEFORE UPDATE ON admins FOR EACH ROW EXECUTE PROCEDURE set_updated_at();
DROP TRIGGER IF EXISTS clients_updated_at ON clients;
CREATE TRIGGER clients_updated_at BEFORE UPDATE ON clients FOR EACH ROW EXECUTE PROCEDURE set_updated_at();
DROP TRIGGER IF EXISTS agents_updated_at ON agents;
CREATE TRIGGER agents_updated_at BEFORE UPDATE ON agents FOR EACH ROW EXECUTE PROCEDURE set_updated_at();
DROP TRIGGER IF EXISTS channels_updated_at ON channels;
CREATE TRIGGER channels_updated_at BEFORE UPDATE ON channels FOR EACH ROW EXECUTE PROCEDURE set_updated_at();
DROP TRIGGER IF EXISTS prompts_updated_at ON prompts;
CREATE TRIGGER prompts_updated_at BEFORE UPDATE ON prompts FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- Default admin (password: admin123). Change in production.
INSERT INTO admins (email, password_hash, name) VALUES (
  'admin@exemplo.com',
  '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
  'Administrador'
) ON CONFLICT (email) DO NOTHING;
