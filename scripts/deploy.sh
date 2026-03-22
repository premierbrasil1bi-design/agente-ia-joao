#!/usr/bin/env bash
# Deploy apenas via Docker: sobe/rebuilda os serviços do compose.
# O backend (saas_backend) resolve Redis em redis://saas_redis:6379 dentro da rede Docker.
# Nada de Node/npm/pm2/redis-cli no host — evita EAI_AGAIN e DNS inexistente fora da bridge.
#
# Logs em tempo real (manual): docker logs -f saas_backend

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

echo "🚀 Iniciando deploy..."
echo "📁 REPO_ROOT=${REPO_ROOT}"

command -v docker >/dev/null 2>&1 || {
  echo "[deploy][erro] docker não encontrado no PATH" >&2
  exit 1
}

docker compose down
docker compose up -d --build

echo "📦 Containers ativos:"
docker ps

echo "📜 Últimas linhas do backend (acompanhar ao vivo: docker logs -f saas_backend):"
docker logs --tail 100 saas_backend 2>&1 || true

echo "✅ Deploy Docker concluído."
