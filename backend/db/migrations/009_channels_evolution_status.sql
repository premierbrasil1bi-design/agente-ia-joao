-- Estado bruto da Evolution API (open, close, connecting, etc.) — domínio interno continua em status (active/inactive).
ALTER TABLE channels
ADD COLUMN IF NOT EXISTS evolution_status TEXT;

COMMENT ON COLUMN channels.evolution_status IS 'Último estado reportado pela Evolution API (texto bruto); status permanece active/inactive.';
