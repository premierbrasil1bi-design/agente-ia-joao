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
