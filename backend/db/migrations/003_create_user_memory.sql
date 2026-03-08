-- Long-term user memory: persistent facts per agent + sender.
CREATE TABLE IF NOT EXISTS user_memory (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  sender_id   VARCHAR(512) NOT NULL,
  memory_key  VARCHAR(255) NOT NULL,
  memory_value TEXT NOT NULL,
  confidence  DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_memory_agent_sender ON user_memory(agent_id, sender_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_memory_agent_sender_key ON user_memory(agent_id, sender_id, memory_key);

COMMENT ON TABLE user_memory IS 'Persistent facts about users (long-term memory) per agent and sender.';
