#!/bin/sh
set -e

# Evolution API + Prisma: o schema usa env("DATABASE_CONNECTION_URI") — NÃO DATABASE_URL.
# Bug conhecido (EvolutionAPI/evolution-api#1474): .env embutido na imagem faz o Nest/dotenv
# ignorar ou sobrepor variáveis do Docker Compose → P1000 com URI "fantasma".
#
# Estratégia: (1) apagar .env concorrentes sob a árvore da app; (2) gravar UM .env canônico
# gerado a partir do ambiente do container (Compose); (3) validar login PostgreSQL com o
# mesmo connection string antes de executar o Node.

echo "[evolution-entrypoint] iniciando (mitigação .env interno + validação DB)..."

# --- Diretório da aplicação (atendai/evolution-api, EvolutionAPI oficial, etc.)
EVO_HOME=""
for d in /evolution /usr/src/evolution /app; do
  if [ -d "$d" ]; then
    EVO_HOME=$d
    break
  fi
done
if [ -z "$EVO_HOME" ]; then
  echo "[evolution-entrypoint] ERRO: nenhum diretório /evolution, /usr/src/evolution ou /app"
  exit 1
fi
cd "$EVO_HOME" || exit 1
echo "[evolution-entrypoint] EVO_HOME=$EVO_HOME"

# --- Remove .env dentro da árvore da app (exceto node_modules/.git profundos via -prune simples)
echo "[evolution-entrypoint] removendo .env legados sob $EVO_HOME..."
find "$EVO_HOME" -maxdepth 8 \( -path '*/node_modules/*' -o -path '*/.git/*' \) -prune -o \
  -name '.env' -type f -print 2>/dev/null | while read -r f; do
  echo "[evolution-entrypoint]   rm -f $f"
  rm -f "$f"
done
for f in /evolution/.env /usr/src/evolution/.env /app/.env; do
  rm -f "$f" 2>/dev/null || true
done

# --- Variáveis obrigatórias / padrões alinhados à documentação v2
export DATABASE_ENABLED="${DATABASE_ENABLED:-true}"
export DATABASE_PROVIDER="${DATABASE_PROVIDER:-postgresql}"
export DATABASE_CONNECTION_URI="${DATABASE_CONNECTION_URI:?DATABASE_CONNECTION_URI obrigatória}"

# --- Grava .env canônico = espelho fiel do ambiente (Compose). Valores com caracteres
#     especiais são escapados via JSON.stringify em Node (formato aceito pelo dotenv).
node <<'WRITEENV'
const fs = require('fs');
const keys = [
  'DATABASE_ENABLED',
  'DATABASE_PROVIDER',
  'DATABASE_CONNECTION_URI',
  'DATABASE_CONNECTION_CLIENT_NAME',
  'CACHE_REDIS_ENABLED',
  'CACHE_REDIS_URI',
  'CACHE_REDIS_PREFIX_KEY',
  'CACHE_LOCAL_ENABLED',
  'AUTHENTICATION_TYPE',
  'AUTHENTICATION_API_KEY',
  'AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES',
  'SERVER_TYPE',
  'SERVER_PORT',
  'LANGUAGE',
  'CORS_ORIGIN',
];
const lines = [
  '# Gerado por evolution-entrypoint — não edite no container; altere docker-compose.yml.',
];
for (const k of keys) {
  const v = process.env[k];
  if (v === undefined || v === '') continue;
  lines.push(`${k}=${JSON.stringify(String(v))}`);
}
fs.writeFileSync('.env', `${lines.join('\n')}\n`);
console.log('[evolution-entrypoint] .env canônico gravado:', process.cwd() + '/.env');
WRITEENV

echo "[evolution-entrypoint] DATABASE_ENABLED=$DATABASE_ENABLED DATABASE_PROVIDER=$DATABASE_PROVIDER"
echo "[evolution-entrypoint] aguardando TCP PostgreSQL (${PGHOST:-saas_postgres}:${PGPORT:-5432})..."

node <<'NODEWAIT'
const net = require('net');
const host = process.env.PGHOST || 'saas_postgres';
const port = parseInt(process.env.PGPORT || '5432', 10);
const maxAttempts = 45;
let attempt = 0;
function once() {
  const c = net.createConnection({ host, port }, () => {
    c.end();
    console.log('[evolution-entrypoint] PostgreSQL aceitou TCP.');
    process.exit(0);
  });
  c.on('error', () => {
    c.destroy();
    attempt++;
    if (attempt >= maxAttempts) {
      console.error('[evolution-entrypoint] FALHA: Postgres TCP indisponível após', maxAttempts, 'tentativas');
      process.exit(1);
    }
    setTimeout(once, 2000);
  });
}
once();
NODEWAIT

echo "[evolution-entrypoint] estabilização pós-TCP (${POSTGRES_STABILIZE_SEC:-10}s)..."
sleep "${POSTGRES_STABILIZE_SEC:-10}"

# --- Valida autenticação real (detecta P1000 antes do Prisma subir)
node <<'NODEPG'
const uri = process.env.DATABASE_CONNECTION_URI;
let pg;
try {
  pg = require('pg');
} catch (e) {
  console.warn('[evolution-entrypoint] pacote pg ausente — pulando teste de auth (confie no Prisma).');
  process.exit(0);
}
const { Client } = pg;
const c = new Client({ connectionString: uri, connectionTimeoutMillis: 20000 });
c.connect()
  .then(() => c.query('SELECT 1 AS evolution_db_probe'))
  .then(() => c.end())
  .then(() => {
    console.log('[evolution-entrypoint] PostgreSQL: autenticação OK (mesma URI do Prisma).');
    process.exit(0);
  })
  .catch((err) => {
    console.error('[evolution-entrypoint] FALHA P1000 / auth (Prisma falharia igual):', err.message);
    console.error('[evolution-entrypoint] Ações: (1) conferir usuário/senha na URI; (2) garantir role em docker/postgres-init; (3) volume antigo sem role:');
    console.error('    docker compose exec saas_postgres psql -U postgres -d evolution -c "\\du"');
    console.error('    ou reset dev: docker compose down -v && docker compose up -d');
    process.exit(1);
  });
NODEPG

if [ "$CLEAR_PRISMA_CLIENT_CACHE" = "true" ]; then
  echo "[evolution-entrypoint] CLEAR_PRISMA_CLIENT_CACHE=true — removendo client Prisma em cache"
  rm -rf ./node_modules/.prisma ./node_modules/@prisma/client 2>/dev/null || true
fi

echo "[evolution-entrypoint] procurando entry da aplicação..."
MAIN=""
if [ -f ./dist/main.js ]; then MAIN=./dist/main.js; fi
if [ -z "$MAIN" ] && [ -f ./dist/src/main.js ]; then MAIN=./dist/src/main.js; fi
if [ -z "$MAIN" ] && [ -f ./main.js ]; then MAIN=./main.js; fi
if [ -z "$MAIN" ]; then
  echo "[evolution-entrypoint] ERRO: entry JS não encontrado"
  ls -la . ./dist 2>/dev/null || true
  exit 1
fi
echo "[evolution-entrypoint] exec node $MAIN"
exec node "$MAIN"
