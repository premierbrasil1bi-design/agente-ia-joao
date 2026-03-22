# Evolution API no Docker — reset, diagnóstico e P1000

## Diagnóstico (como a Evolution realmente carrega o banco)

1. **Prisma** (`prisma/postgresql-schema.prisma` na Evolution API v2): `url = env("DATABASE_CONNECTION_URI")`.  
   Definir só `DATABASE_URL` **não** altera a conexão do Prisma dessa stack.

2. **`.env` interno da imagem** (issue [#1474](https://github.com/EvolutionAPI/evolution-api/issues/1474)): o Nest/dotenv pode ler um `.env` empacotado na imagem e **não** refletir o que você colocou no `docker-compose.yml`.

3. **P1000 (authentication failed)** com Postgres saudável e hostname resolvendo quase sempre é:
   - URI com **usuário/senha** que não batem com o Postgres, ou
   - volume `postgres_data` **criado antes** do script `docker/postgres-init` (role `evolution` nunca foi criada).

## O que o projeto aplica (workaround definitivo no repo)

- `docker/evolution/entrypoint.sh` remove `.env` sob a árvore da app, grava **um** `.env` gerado a partir das variáveis **do container** (Compose) e, se o pacote `pg` existir na imagem, executa `SELECT 1` com a **mesma** `DATABASE_CONNECTION_URI` antes de subir o Node (falha rápido com mensagem clara).

## Reset completo (dev — apaga dados do Postgres e Redis persistidos pelo Compose)

Na raiz do repositório:

```bash
docker compose down -v --remove-orphans
docker compose pull
docker compose build --no-cache
docker compose up -d
```

Aguarde `saas_postgres` healthy, depois:

```bash
docker compose logs -f saas_evolution
```

Você deve ver: `PostgreSQL: autenticação OK` e, em seguida, o boot da API. Teste:

```bash
curl -sS -o /dev/null -w "%{http_code}" -H "apikey: EVOLUTION_2026_JOAO_998877" http://127.0.0.1:8080/instance/fetchInstances
```

Esperado: HTTP **200** (ou 401 se a key estiver errada — ajuste `AUTHENTICATION_API_KEY` no compose).

## Reset sem apagar banco (só recriar container Evolution)

```bash
docker compose up -d --force-recreate saas_evolution
docker compose logs -f saas_evolution
```

## Conferir role `evolution` sem apagar volume

```bash
docker compose exec saas_postgres psql -U postgres -d evolution -c "\du"
```

Se `evolution` não existir, crie manualmente (senha alinhada à URI do compose) ou rode o reset com `-v` para reaplicar `docker/postgres-init`.

## Conflito com volume `evolution_store`

Em geral só guarda mídia/arquivos. Se suspeitar de estado corrompido:

```bash
docker compose down
docker volume rm agente-ia-omnicanal_evolution_store
docker compose up -d
```

(ajuste o nome do volume com `docker volume ls | findstr evolution`.)

## Variáveis que devem permanecer coerentes

| Variável | Observação |
|----------|------------|
| `DATABASE_CONNECTION_URI` | Deve usar host `saas_postgres` (nome do **serviço** na rede Compose). |
| `DATABASE_ENABLED` | `true` para Prisma/persistência. |
| `CACHE_REDIS_URI` | Host `redis` (nome do serviço), não `localhost`. |
