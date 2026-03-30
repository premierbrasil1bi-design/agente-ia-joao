-- Garante provider_config em produções que não rodaram 015 (evita 500 em SELECT/UPDATE de canais).

ALTER TABLE channels
ADD COLUMN IF NOT EXISTS provider_config JSONB DEFAULT '{}'::jsonb;
