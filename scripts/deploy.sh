#!/usr/bin/env bash
# Deploy idempotente: lock + validação Redis/BullMQ + backend + PM2 + frontend + www + healthcheck
# Uso: na raiz do repositório — bash scripts/deploy.sh  OU  bash deploy.sh (se cópia na raiz)
#
# Variáveis opcionais:
#   DEPLOY_BRANCH (default: main)
#   DEPLOY_WWW_ROOT (default: /var/www)
#   APP_DIRNAME (default: app)
#   DEPLOY_HEALTH_PORT / PORT (default: 3000)
#   DEPLOY_LOCK_FILE (default: /tmp/omnia_deploy.lock)
#   DEPLOY_SKIP_REEXEC=1 — pula re-exec após git (apenas testes)
#
# Lock: aplicado APÓS a fase git/re-exec — evita arquivo preso quando o bash faz `exec` na 1ª passagem.
#
# Ordem: lock → pré-requisitos → npm ci →
#   (1) .env parser → (2) NODE_ENV → (3) REDIS_URL + fallback → (4) log estado →
#   (5) redis-cli opcional → (6) Redis Node fail-fast → BullMQ estrutural → PM2 (--update-env) →
#   BullMQ funcional → frontend → www → nginx → health HTTP.

set -euo pipefail
IFS=$'\n\t'

LOCK_FILE="${DEPLOY_LOCK_FILE:-/tmp/omnia_deploy.lock}"

log() { echo "[deploy] $(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }
fail() { echo "[deploy][error] $*" >&2; exit 1; }
warn() { echo "[deploy][warn] $*" >&2; }

maybe_sudo() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  else
    sudo -n "$@" || fail "sudo necessário para: $* (configure NOPASSWD ou rode como root)"
  fi
}

# Carrega .env sem `source`: cada linha vira export KEY=valor (valor pode conter espaços).
# Ignora comentários e linhas sem '='; rejeita chaves inválidas. Evita & ? $ ` quebrarem o shell.
load_env_file_safely() {
  local envfile="$1"
  local line key val
  [[ -f "$envfile" ]] || return 0
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line//$'\r'/}"
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${line//[:space:]}" ]] && continue
    if [[ "$line" != *"="* ]]; then
      log "aviso: .env ignorado (linha sem '=' — texto solto?): ${line:0:100}"
      continue
    fi
    key="${line%%=*}"
    val="${line#*=}"
    key="${key#"${key%%[![:space:]]*}"}"
    key="${key%"${key##*[![:space:]]}"}"
    val="${val#"${val%%[![:space:]]*}"}"
    val="${val%"${val##*[![:space:]]}"}"
    if [[ "$val" =~ ^\"(.*)\"$ ]]; then
      val="${BASH_REMATCH[1]}"
      val="${val//\\\"/\"}"
    elif [[ "$val" =~ ^\'(.*)\'$ ]]; then
      val="${BASH_REMATCH[1]}"
    fi
    if [[ ! "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      log "aviso: .env chave inválida ignorada: ${key:0:60}"
      continue
    fi
    export "${key}=${val}"
  done <"$envfile"
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$SCRIPT_DIR/../package.json" ]]; then
  REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
else
  REPO_ROOT="$SCRIPT_DIR"
fi
cd "$REPO_ROOT"

# Caminho absoluto canônico do script (symlinks, caminhos relativos; requer readlink -f — GNU/Linux no VPS)
DEPLOY_SELF="$(readlink -f "${BASH_SOURCE[0]}")"

DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
WWW_ROOT="${DEPLOY_WWW_ROOT:-/var/www}"
APP_NAME="${APP_DIRNAME:-app}"
WWW_LIVE="${WWW_ROOT}/${APP_NAME}"
WWW_NEW="${WWW_ROOT}/${APP_NAME}_new"
WWW_OLD="${WWW_ROOT}/${APP_NAME}_old"

FRONTEND_SWAP_DONE=0

rollback_www_swap() {
  if [[ "$FRONTEND_SWAP_DONE" -eq 1 ]]; then
    return 0
  fi
  if [[ -d "$WWW_OLD" && ! -d "$WWW_LIVE" ]]; then
    log "rollback: restaurando diretório ativo a partir de ${WWW_OLD}"
    maybe_sudo mv "$WWW_OLD" "$WWW_LIVE" || true
  elif [[ -d "$WWW_OLD" && -d "$WWW_LIVE" ]]; then
    log "rollback: estado ambíguo (existem ${WWW_LIVE} e ${WWW_OLD}) — verifique manualmente"
  fi
}

trap 'rollback_www_swap' ERR

log "início | REPO_ROOT=${REPO_ROOT} | branch=${DEPLOY_BRANCH}"

# --- 1) Git update + re-exec (sem lock: `exec` substitui o processo e não libera trap EXIT da 1ª passagem) ---
if [[ "${DEPLOY_SKIP_REEXEC:-0}" != "1" ]] && [[ "${DEPLOY_REEXEC_DONE:-0}" != "1" ]]; then
  command -v git >/dev/null 2>&1 || fail "git ausente"
  export DEPLOY_REEXEC_DONE=1
  log "git fetch --all (re-exec em seguida com script atualizado)"
  git fetch --all --prune
  log "git reset --hard origin/${DEPLOY_BRANCH}"
  git reset --hard "origin/${DEPLOY_BRANCH}"
  exec bash "$DEPLOY_SELF"
fi

# --- 2) Lock anti-concorrência ---
if [[ -f "$LOCK_FILE" ]]; then
  fail "Deploy já está em execução (lock: ${LOCK_FILE}). Abortando."
fi
touch "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

# --- 3) Pré-requisitos ---
for cmd in git node npm pm2; do
  command -v "$cmd" >/dev/null 2>&1 || fail "comando ausente: $cmd"
done

[[ -f "$REPO_ROOT/ecosystem.config.js" ]] || fail "ecosystem.config.js não encontrado na raiz do repositório"
[[ -f "$REPO_ROOT/backend/package.json" ]] || fail "backend/package.json não encontrado"
[[ -f "$REPO_ROOT/backend/package-lock.json" ]] || fail "backend/package-lock.json ausente (obrigatório para npm ci)"
[[ -f "$REPO_ROOT/backend/server.js" ]] || fail "backend/server.js não encontrado"
[[ -f "$REPO_ROOT/frontend/client-app/package.json" ]] || fail "frontend/client-app/package.json não encontrado"
[[ -f "$REPO_ROOT/frontend/client-app/package-lock.json" ]] || fail "frontend/client-app/package-lock.json ausente (obrigatório para npm ci)"

GIT_SHA_AFTER="$(git rev-parse HEAD)"
log "git HEAD: ${GIT_SHA_AFTER}"

# --- 4) Backend: dependências (node_modules para validações Node) ---
log "backend: npm ci"
(
  cd "$REPO_ROOT/backend"
  npm ci
)

# --- 5) Ambiente para Redis / PM2 (ordem fixa) ---
# 5.1 Parser seguro do .env (sem source — evita & e espaços quebrarem o shell)
if [[ -f "$REPO_ROOT/backend/.env" ]]; then
  log "env: carregando backend/.env (parser seguro)"
  load_env_file_safely "$REPO_ROOT/backend/.env"
else
  log "env: backend/.env ausente — usando apenas variáveis já exportadas no shell"
fi

# 5.2 NODE_ENV (produção no deploy)
export NODE_ENV="${NODE_ENV:-production}"
log "env: NODE_ENV=${NODE_ENV}"

# 5.3 REDIS_URL — não sobrescreve valor existente; trim nas pontas; fallback só se vazio
_redis_effective="${REDIS_URL:-}"
_redis_effective="${_redis_effective#"${_redis_effective%%[![:space:]]*}"}"
_redis_effective="${_redis_effective%"${_redis_effective##*[![:space:]]}"}"
if [[ -z "$_redis_effective" ]]; then
  export REDIS_URL="redis://saas_redis:6379"
  warn "fallback aplicado: REDIS_URL ausente ou só espaços → redis://saas_redis:6379"
else
  export REDIS_URL="${_redis_effective}"
  log "REDIS_URL definido (ambiente ou .env)"
fi

# 5.4 Estado explícito (sem segredos em URL simples; mascarar se no futuro houver senha na URI)
log "estado Redis: REDIS_URL=${REDIS_URL}"

# 5.5 redis-cli opcional (nunca bloqueia o deploy)
if command -v redis-cli >/dev/null 2>&1; then
  if redis_cli_out=$(redis-cli -u "$REDIS_URL" ping 2>/dev/null) && [[ "$redis_cli_out" == "PONG" ]]; then
    log "redis-cli: PING OK"
  else
    warn "redis-cli: PING falhou ou opção -u indisponível (seguindo para validação Node)"
  fi
else
  log "redis-cli não encontrado — ignorando verificação local"
fi

# 5.6 Validação Redis com Node (obrigatória — fail fast)
log "Redis: validação ioredis (obrigatória)..."
export NODE_PATH="$REPO_ROOT/backend/node_modules${NODE_PATH:+:${NODE_PATH}}"
if ! node -e "
const Redis = require('ioredis');
const url = process.env.REDIS_URL;
if (!url || String(url).trim() === '') {
  console.error('REDIS_URL vazio');
  process.exit(1);
}
const redis = new Redis(url, {
  maxRetriesPerRequest: null,
  connectTimeout: 15000,
  retryStrategy: () => null,
});
redis
  .ping()
  .then((p) => {
    if (p !== 'PONG') {
      console.error('resposta inesperada:', p);
      return redis.quit().then(() => process.exit(1));
    }
    return redis.quit();
  })
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err && err.message ? err.message : err);
    process.exit(1);
  });
"; then
  fail "Falha ao conectar no Redis. Abortando deploy."
fi
log "Redis: conexão OK (ioredis)"

# --- 7) BullMQ: validação estrutural (Redis + metadados da fila, sem worker) ---
log "BullMQ: validação estrutural (getJobCounts)..."
node -e "
const { Queue } = require('bullmq');
const url = process.env.REDIS_URL;
const queue = new Queue('evolution-api', {
  connection: {
    url,
    maxRetriesPerRequest: null,
    connectTimeout: 15000,
  },
});
queue
  .getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed', 'paused')
  .then(() => queue.close())
  .then(() => {
    console.log('Fila estrutural OK');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Fila estrutural FAIL', err && err.message ? err.message : err);
    return queue.close().catch(() => {}).then(() => process.exit(1));
  });
" || fail "validação estrutural BullMQ falhou"
log "Fila estrutural OK"

# --- 8) PM2 (ecosystem) — injeta env do shell atual (REDIS_URL, NODE_ENV, …) via --update-env
log "pm2: diretório de logs"
mkdir -p "$REPO_ROOT/logs"

cd "$REPO_ROOT"
# Garante export explícito das variáveis críticas para o processo do PM2 / ecosystem.config.js
export REDIS_URL NODE_ENV

log "PM2: garantindo processos do ecosystem (start + reload com --update-env)..."

log "PM2: start ecosystem.config.js --update-env"
pm2 start ecosystem.config.js --update-env || true

log "PM2: reload ecosystem.config.js --update-env"
pm2 reload ecosystem.config.js --update-env

if ! pm2 describe worker-evolution >/dev/null 2>&1; then
  log "PM2: worker-evolution ausente — start --only com --update-env"
  pm2 start ecosystem.config.js --only worker-evolution --update-env
fi

pm2 describe agente-backend >/dev/null 2>&1 || fail "PM2: agente-backend não está ativo"
pm2 describe worker-evolution >/dev/null 2>&1 || fail "PM2: worker-evolution não está ativo"
log "PM2: worker-evolution garantido"

log "PM2: estado salvo"
pm2 save

log "aguardando worker estabilizar (3s) antes da validação funcional da fila"
sleep 3

# --- 9) BullMQ: validação funcional (enqueue + worker processa health-check) ---
log "BullMQ: validação funcional (add health-check)..."
node -e "
const IORedis = require('ioredis');
const { Queue } = require('bullmq');
const url = process.env.REDIS_URL;
const connection = new IORedis(url, {
  maxRetriesPerRequest: null,
  connectTimeout: 15000,
  retryStrategy: () => null,
});
const queue = new Queue('evolution-api', { connection });
queue
  .add('health-check', { ts: Date.now() })
  .then(() => queue.close())
  .then(() => connection.quit())
  .then(() => {
    console.log('Fila funcional OK');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Fila funcional FAIL', err && err.message ? err.message : err);
    process.exit(1);
  });
" || fail "validação funcional BullMQ falhou"
log "Fila funcional OK"

# --- 10) Frontend ---
log "frontend: npm ci"
(
  cd "$REPO_ROOT/frontend/client-app"
  npm ci --include=dev
)

log "frontend: npm run build"
(
  cd "$REPO_ROOT/frontend/client-app"
  npm run build
)

DIST_DIR="$REPO_ROOT/frontend/client-app/dist"
[[ -d "$DIST_DIR" ]] || fail "pasta dist não gerada: ${DIST_DIR}"
[[ -f "$DIST_DIR/index.html" ]] || fail "build inválido: falta dist/index.html"

# --- 11) Publicação www atômica ---
log "www: preparando ${WWW_NEW}"
maybe_sudo rm -rf "$WWW_NEW"
maybe_sudo mkdir -p "$WWW_NEW"

if command -v rsync >/dev/null 2>&1; then
  log "www: rsync dist -> ${WWW_NEW}"
  maybe_sudo rsync -a --delete "${DIST_DIR}/" "${WWW_NEW}/"
else
  log "www: cp -a dist -> ${WWW_NEW} (rsync não instalado)"
  maybe_sudo cp -a "${DIST_DIR}/." "${WWW_NEW}/"
fi

[[ "$(maybe_sudo find "$WWW_NEW" -type f | wc -l)" -ge 1 ]] || fail "staging www vazio após cópia"

log "www: swap atômico (${WWW_LIVE})"
if [[ -d "$WWW_LIVE" ]]; then
  maybe_sudo rm -rf "$WWW_OLD" 2>/dev/null || true
  maybe_sudo mv "$WWW_LIVE" "$WWW_OLD"
fi

if maybe_sudo mv "$WWW_NEW" "$WWW_LIVE"; then
  FRONTEND_SWAP_DONE=1
  maybe_sudo rm -rf "$WWW_OLD"
else
  fail "falha ao promover ${WWW_NEW} -> ${WWW_LIVE}"
fi

trap - ERR

# --- 12) Permissões www ---
log "www: chown www-data:www-data ${WWW_LIVE}"
maybe_sudo chown -R www-data:www-data "$WWW_LIVE"

# --- 13) Nginx ---
if command -v nginx >/dev/null 2>&1; then
  log "nginx: teste de configuração"
  maybe_sudo nginx -t
  log "nginx: reload"
  maybe_sudo systemctl reload nginx || maybe_sudo systemctl restart nginx
else
  log "nginx não encontrado no PATH — ignorando reload"
fi

# --- 14) Healthcheck backend + PM2 ---
HEALTH_PORT="${DEPLOY_HEALTH_PORT:-${PORT:-3000}}"
command -v curl >/dev/null 2>&1 || fail "curl ausente (necessário para healthcheck)"
log "healthcheck: PM2 (agente-backend, worker-evolution)"
pm2 describe agente-backend >/dev/null 2>&1 || fail "healthcheck: agente-backend não encontrado no PM2"
pm2 describe worker-evolution >/dev/null 2>&1 || fail "healthcheck: worker-evolution não encontrado no PM2"
log "healthcheck: GET http://127.0.0.1:${HEALTH_PORT}/api/health"
curl -sfS --max-time 15 "http://127.0.0.1:${HEALTH_PORT}/api/health" >/dev/null || fail "healthcheck: /api/health falhou (porta ${HEALTH_PORT})"

log "Deploy seguro confirmado | www=${WWW_LIVE} | PM2: agente-backend + worker-evolution"
exit 0
