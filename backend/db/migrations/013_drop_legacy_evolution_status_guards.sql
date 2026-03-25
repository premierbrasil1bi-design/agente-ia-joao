-- OMNIA: evolution_status foi descontinuada; connection_status (migration 010) é a fonte de verdade.
-- Idempotente: ambientes que já removeram a coluna não falham.

ALTER TABLE channels DROP COLUMN IF EXISTS evolution_status;

COMMENT ON COLUMN channels.connection_status IS
  'Estado operacional WhatsApp/Evolution: connecting, connected, disconnected, error. Fonte de verdade; external_id referencia a instância na Evolution API. Não recrie evolution_status.';
