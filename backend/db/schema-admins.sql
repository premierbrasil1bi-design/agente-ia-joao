-- =============================================================================
-- Tabela admins – autenticação do painel administrativo.
-- Executar após schema.sql (Neon).
-- =============================================================================

CREATE TABLE IF NOT EXISTS admins (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  name          VARCHAR(255),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admins_email ON admins(email);

CREATE TRIGGER admins_updated_at BEFORE UPDATE ON admins FOR EACH ROW EXECUTE PROCEDURE set_updated_at();

-- Admin inicial (senha: admin123) – TROCAR EM PRODUÇÃO
-- Hash bcrypt para 'admin123' (gerado com bcryptjs, 10 rounds)
INSERT INTO admins (email, password_hash, name) VALUES (
  'admin@exemplo.com',
  '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
  'Administrador'
) ON CONFLICT (email) DO NOTHING;
