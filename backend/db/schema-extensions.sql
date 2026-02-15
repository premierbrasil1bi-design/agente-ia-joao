-- =============================================================================
-- Extensões do esquema – uso, cobrança e planos (SaaS)
-- Executar após schema.sql
-- =============================================================================

-- Drop em ordem reversa de dependência (estrutura correta ao reexecutar)
DROP TABLE IF EXISTS billing CASCADE;
DROP TABLE IF EXISTS usage_logs CASCADE;
DROP TABLE IF EXISTS plans CASCADE;

-- Planos (preparação para cobrança por canal/mensagem/agente)
CREATE TABLE IF NOT EXISTS plans (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID REFERENCES clients(id) ON DELETE CASCADE,
  name        VARCHAR(100) NOT NULL,
  slug        VARCHAR(50) NOT NULL,
  limits      JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plans_client_id ON plans(client_id);

-- Registro de uso (mensagens, tokens, custo estimado) – para cobrança e métricas
CREATE TABLE IF NOT EXISTS usage_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         UUID REFERENCES clients(id) ON DELETE CASCADE,
  agent_id          UUID REFERENCES agents(id) ON DELETE CASCADE,
  channel_id        UUID REFERENCES channels(id) ON DELETE SET NULL,
  channel_type      VARCHAR(50) NOT NULL,
  messages_sent     INTEGER NOT NULL DEFAULT 0,
  messages_received INTEGER NOT NULL DEFAULT 0,
  tokens            INTEGER NOT NULL DEFAULT 0,
  estimated_cost    DECIMAL(12, 6) NOT NULL DEFAULT 0,
  recorded_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_usage_logs_client_id ON usage_logs(client_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_agent_id ON usage_logs(agent_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_recorded_at ON usage_logs(recorded_at);

-- Faturamento (ciclos de cobrança)
CREATE TABLE IF NOT EXISTS billing (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  plan_id     UUID REFERENCES plans(id) ON DELETE SET NULL,
  period_start DATE NOT NULL,
  period_end   DATE NOT NULL,
  amount      DECIMAL(12, 2) NOT NULL DEFAULT 0,
  status      VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_client_id ON billing(client_id);
CREATE INDEX IF NOT EXISTS idx_billing_period ON billing(period_start, period_end);

DROP TRIGGER IF EXISTS plans_updated_at ON plans;
CREATE TRIGGER plans_updated_at BEFORE UPDATE ON plans FOR EACH ROW EXECUTE PROCEDURE set_updated_at();
DROP TRIGGER IF EXISTS billing_updated_at ON billing;
CREATE TRIGGER billing_updated_at BEFORE UPDATE ON billing FOR EACH ROW EXECUTE PROCEDURE set_updated_at();
