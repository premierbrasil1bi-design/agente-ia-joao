-- Campos para fluxo de conexão de canais (Evolution API / WhatsApp).
ALTER TABLE channels
ADD COLUMN IF NOT EXISTS provider TEXT;

ALTER TABLE channels
ADD COLUMN IF NOT EXISTS config JSONB DEFAULT '{}'::jsonb;

ALTER TABLE channels
ADD COLUMN IF NOT EXISTS external_id TEXT;

ALTER TABLE channels
ADD COLUMN IF NOT EXISTS connected_at TIMESTAMPTZ;

ALTER TABLE channels
ADD COLUMN IF NOT EXISTS last_error TEXT;

-- Permitir valores de status do fluxo de conexão (draft, connecting, connected, disconnected)
ALTER TABLE channels DROP CONSTRAINT IF EXISTS channels_status_check;

CREATE INDEX IF NOT EXISTS idx_channels_status
ON channels(status);

COMMENT ON COLUMN channels.external_id IS 'Identificador na API externa (ex: nome da instância Evolution).';
COMMENT ON COLUMN channels.provider IS 'Provedor do canal (ex: evolution).';
