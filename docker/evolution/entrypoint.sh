#!/bin/sh
set -e

# 1) Impede que .env embutido na imagem sobrescreva variáveis injetadas pelo docker-compose
echo "[evolution-entrypoint] removendo .env internos (prioridade só para env do Compose)..."
for f in /evolution/.env /usr/src/evolution/.env /app/.env; do
  rm -f "$f" 2>/dev/null || true
done

# 2) Diretório de trabalho comum nas imagens atendai/evolution-api
if [ -d /evolution ]; then
  cd /evolution
elif [ -d /usr/src/evolution ]; then
  cd /usr/src/evolution
fi

# 3) Export explícito (runtime) — reforça DATABASE_* para o processo Node
export DATABASE_PROVIDER="${DATABASE_PROVIDER:-postgresql}"
export DATABASE_CONNECTION_URI="${DATABASE_CONNECTION_URI:?DATABASE_CONNECTION_URI obrigatória}"

echo "[evolution-entrypoint] DATABASE_PROVIDER=$DATABASE_PROVIDER"
echo "[evolution-entrypoint] aguardando PostgreSQL em saas_postgres:5432 (TCP)..."

# 4) Espera ativa via Node (sempre presente na imagem) — healthcheck do Compose já garante DB,
#    mas isso cobre race entre "aceita TCP" e "auth pronta"
node <<'NODEWAIT'
const net = require('net');
const host = process.env.PGHOST || 'saas_postgres';
const port = parseInt(process.env.PGPORT || '5432', 10);
const maxAttempts = 45;
let attempt = 0;
function once() {
  const c = net.createConnection({ host, port }, () => {
    c.end();
    console.log('[evolution-entrypoint] PostgreSQL respondeu em TCP, iniciando Evolution...');
    process.exit(0);
  });
  c.on('error', () => {
    c.destroy();
    attempt++;
    if (attempt >= maxAttempts) {
      console.error('[evolution-entrypoint] FALHA: Postgres não disponível após', maxAttempts, 'tentativas');
      process.exit(1);
    }
    setTimeout(once, 2000);
  });
}
once();
NODEWAIT

echo "[evolution-entrypoint] estabilização pós-TCP (10s) antes do Node/Prisma..."
sleep 10

if [ "$CLEAR_PRISMA_CLIENT_CACHE" = "true" ]; then
  echo "[evolution-entrypoint] CLEAR_PRISMA_CLIENT_CACHE=true — removendo node_modules/.prisma"
  rm -rf ./node_modules/.prisma ./node_modules/@prisma/client 2>/dev/null || true
fi

echo "[evolution-entrypoint] procurando entry da aplicação..."
MAIN=
if [ -f ./dist/main.js ]; then MAIN=./dist/main.js; fi
if [ -z "$MAIN" ] && [ -f ./dist/src/main.js ]; then MAIN=./dist/src/main.js; fi
if [ -z "$MAIN" ] && [ -f ./main.js ]; then MAIN=./main.js; fi
if [ -z "$MAIN" ]; then
  echo "[evolution-entrypoint] ERRO: entry JS não encontrado (dist/main.js, dist/src/main.js, main.js)"
  ls -la . ./dist 2>/dev/null || true
  exit 1
fi
echo "[evolution-entrypoint] usando: $MAIN"
exec node "$MAIN"
