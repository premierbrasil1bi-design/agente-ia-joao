# Banco de dados (Neon – PostgreSQL)

## Esquema

- **schema.sql** – tabelas principais: clients, agents, channels, prompts, messages, costs, admins (e triggers).
- **schema-extensions.sql** – planos, usage_logs, billing (executar após schema.sql).

## Ordem correta de inicialização

1. **Schema** (cria as tabelas)
2. **Extensions** (tabelas extras; depende de schema.sql)
3. **Seed** (dados iniciais: cliente, agente, canal WEB, prompt)

## Comandos no terminal (a partir da pasta `backend`)

Garanta que o `.env` tenha `DATABASE_URL` apontando para o Neon.

```bash
cd backend
```

**1. Aplicar schemas no banco (obrigatório antes do seed):**

```bash
node scripts/run-schema.js
```

Isso executa, na ordem, `db/schema.sql` e `db/schema-extensions.sql` usando a `DATABASE_URL` do `.env`.

**2. Rodar o seed (cliente inicial, agente, canal WEB, prompt):**

```bash
node scripts/seed-dashboard.js
```

## Alternativa: SQL Editor do Neon

Se preferir rodar o SQL manualmente no painel Neon:

1. Abra o **SQL Editor** do projeto.
2. Cole e execute o conteúdo completo de **db/schema.sql**.
3. Depois, cole e execute o conteúdo completo de **db/schema-extensions.sql**.
4. Por fim, rode o seed no terminal: `node scripts/seed-dashboard.js`.

Se `DATABASE_URL` não estiver definida, o backend continua funcionando e o painel usa dados simulados.

## Migrations em `db/migrations/`

Aplicar no Neon (SQL Editor ou cliente `psql`) **na ordem numérica** após o schema base, conforme a evolução do projeto.

### Canais Evolution e `external_id`

- **`external_id`** no canal com `provider = 'evolution'` é o **nome da instância na Evolution API** (o mesmo valor enviado em webhooks como `instance` / `instanceName`).
- A partir da migration **`011_unique_evolution_external_id.sql`**, existe **no máximo um** canal por `external_id` entre todos os tenants (unicidade **global** na tabela `channels`, só para `provider = 'evolution'` e `external_id IS NOT NULL`).
- Isto alinha webhooks e sync: uma instância Evolution mapeia a um único canal OMNIA.

**Antes de aplicar 011**, verificar duplicados:

```sql
SELECT external_id, COUNT(*) AS n
FROM channels
WHERE provider = 'evolution'
  AND external_id IS NOT NULL
GROUP BY external_id
HAVING COUNT(*) > 1;
```

Se houver resultados, corrigir dados à mão; a migration aborta com mensagem explícita e **não** cria o índice até ficar consistente.

### Alertas críticos (`012_system_errors.sql`)

- Tabela **`system_errors`**: persiste eventos como **`EVOLUTION_INVARIANT_BROKEN`** (duplicidade `external_id` / Evolution), além dos logs.
- Webhook opcional: variável **`EVOLUTION_INVARIANT_WEBHOOK_URL`** — recebe POST JSON com `type`, `external_id`, `duplicate_row_count`, `channels` (fire-and-forget).
- Rate limit em Redis: chave `evolution:invariant_alert:<external_id>` com **`EVOLUTION_INVARIANT_ALERT_TTL_SEC`** (padrão 60). Se a chave já existir, não grava de novo nem chama webhook — log **`[EVOLUTION][ALERT_SKIPPED_RATE_LIMIT]`**.
- Após persistir + webhook (quando não rate-limited), o backend emite **`[EVOLUTION][ALERT_SENT]`** (útil no PM2).
