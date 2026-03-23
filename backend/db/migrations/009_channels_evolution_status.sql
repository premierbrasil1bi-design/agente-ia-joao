-- Estado bruto da Evolution API (open, close, connecting, etc.) — domínio interno continua em status (active/inactive).
ALTER TABLE channels
ADD COLUMN IF NOT EXISTS evolution_status TEXT;
