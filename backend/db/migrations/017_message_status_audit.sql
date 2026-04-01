ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS conversation_id VARCHAR(255) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS provider VARCHAR(50) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS external_message_id VARCHAR(255) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'SENT',
  ADD COLUMN IF NOT EXISTS status_updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_messages_external_message_id ON messages(external_message_id);
CREATE INDEX IF NOT EXISTS idx_messages_tenant_channel_conversation ON messages(tenant_id, channel_id, conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status);

CREATE TABLE IF NOT EXISTS message_status_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL,
  event_type VARCHAR(20) NOT NULL,
  raw_payload JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_message_status_events_message_id ON message_status_events(message_id);
CREATE INDEX IF NOT EXISTS idx_message_status_events_tenant_id ON message_status_events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_message_status_events_provider ON message_status_events(provider);

