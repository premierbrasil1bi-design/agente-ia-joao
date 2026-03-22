-- Usuário dedicado para a Evolution API (evita conflitos/saturação com o superuser postgres).
-- Executado apenas na primeira inicialização do volume (docker-entrypoint-initdb.d).
-- Banco atual: evolution (POSTGRES_DB).

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'evolution') THEN
    CREATE ROLE evolution LOGIN PASSWORD 'evolution123';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE evolution TO evolution;
GRANT TEMP ON DATABASE evolution TO evolution;
GRANT ALL PRIVILEGES ON DATABASE evolution TO evolution;

GRANT USAGE ON SCHEMA public TO evolution;
GRANT CREATE ON SCHEMA public TO evolution;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO evolution;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO evolution;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO evolution;

-- Objetos já criados (ex.: volume antigo com tabelas do Prisma como postgres):
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO evolution;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO evolution;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO evolution;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO evolution;
