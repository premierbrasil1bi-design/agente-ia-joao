-- Estado explícito da conexão WhatsApp/Evolution (SaaS).
-- Dual-write com channels.status (active/inactive) permanece para código legado.

ALTER TABLE channels
ADD COLUMN IF NOT EXISTS connection_status VARCHAR(32) NOT NULL DEFAULT 'disconnected';

ALTER TABLE channels DROP CONSTRAINT IF EXISTS channels_connection_status_check;

ALTER TABLE channels ADD CONSTRAINT channels_connection_status_check
  CHECK (connection_status IN ('connecting', 'connected', 'disconnected', 'error'));

UPDATE channels SET connection_status = 'connected' WHERE status = 'active';

COMMENT ON COLUMN channels.connection_status IS 'Conexão WhatsApp/Evolution: connecting, connected, disconnected, error.';
