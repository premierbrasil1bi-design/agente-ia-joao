-- Admins: coluna active para suspender/reativar usuários de tenant
ALTER TABLE admins ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;
COMMENT ON COLUMN admins.active IS 'Se false, usuário não pode fazer login (suspenso pelo Global Admin).';
