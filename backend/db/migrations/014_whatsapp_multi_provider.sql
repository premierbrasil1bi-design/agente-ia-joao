-- Multi-provider WhatsApp (WAHA + Evolution + Z-API) com fallback.

ALTER TABLE channels ADD COLUMN IF NOT EXISTS provider VARCHAR;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS fallback_providers JSONB DEFAULT '[]'::jsonb;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS config JSONB DEFAULT '{}'::jsonb;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS connection_status VARCHAR(32) NOT NULL DEFAULT 'disconnected';
ALTER TABLE channels ADD COLUMN IF NOT EXISTS last_error TEXT;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS provider_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  provider VARCHAR NOT NULL,
  status VARCHAR NOT NULL,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_provider_logs_channel_id_created_at
  ON provider_logs(channel_id, created_at DESC);
