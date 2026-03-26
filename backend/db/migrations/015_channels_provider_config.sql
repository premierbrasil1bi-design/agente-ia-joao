-- Provider desacoplado por canal (multi-provider WhatsApp).

ALTER TABLE channels
ADD COLUMN IF NOT EXISTS provider TEXT;

UPDATE channels
SET provider = 'waha'
WHERE provider IS NULL OR btrim(provider) = '';

ALTER TABLE channels
ALTER COLUMN provider SET DEFAULT 'waha';

ALTER TABLE channels
ALTER COLUMN provider SET NOT NULL;

ALTER TABLE channels
ADD COLUMN IF NOT EXISTS provider_config JSONB DEFAULT '{}'::jsonb;
