# Integração Neon (PostgreSQL) – Caminho completo

Este documento descreve **onde configurar**, **quais arquivos** fazem a conexão, **quais rotas** usam dados reais e **como validar** que o Neon está conectado.

---

## 1. Onde configurar o DATABASE_URL

- **Arquivo:** `backend/.env` (crie na raiz da pasta `backend` se não existir).
- **Variável:** `DATABASE_URL`
- **Valor:** Connection string do projeto Neon (ex.: `postgresql://user:password@host.neon.tech/dbname?sslmode=require`).

**Como obter a connection string:**
1. Acesse [Neon Console](https://console.neon.tech).
2. Selecione o projeto (ou crie um).
3. Em **Connection details** ou **Dashboard**, copie a **Connection string** (Pooled ou Direct).
4. Cole no `.env`: `DATABASE_URL=postgresql://...`

**Exemplo de `.env`:**
```env
PORT=3000
OPENAI_API_KEY=sk-...
DATABASE_URL=postgresql://usuario:senha@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require
```

---

## 2. Quais arquivos fazem a conexão

| Arquivo | Função |
|---------|--------|
| **backend/config/env.js** | Centraliza variáveis de ambiente (inclui `DATABASE_URL`). Valida e loga avisos no startup (nunca loga valores de secrets). |
| **backend/db/connection.js** | Único ponto de conexão. Exporta `getPool()`, `query()`, `isConnected()`, `isDbConnected()`, `closePool()`. Usa `config.databaseUrl`. Se ausente, `getPool()` retorna `null` e loga "[db] Neon não conectado — usando dados simulados". |
| **backend/repositories/*.js** | Todos importam `query` de `../db/connection.js` e usam `query(sql, params)`. Não acessam o pool diretamente. |
| **backend/server.js** | Importa `config` e chama `getPool()` no startup. Endpoint **GET /api/health/db** usa `isDbConnected()` para validar conectividade real. |

Nenhum outro arquivo deve criar conexão com o banco; todo acesso passa por `connection.js` e pelos repositórios.

---

## 3. Quais rotas passam a usar dados reais (quando Neon está ativo)

Quando `DATABASE_URL` está definida e o Neon está acessível:

| Rota / recurso | Dados reais |
|----------------|-------------|
| **GET /api/context** | client_id, agent_id, channel, prompt_id, canal_nome (agents, channels, prompts). |
| **GET /api/dashboard/summary** | Custos, mensagens, status, alertas (agents, channels, costs). |
| **GET /api/dashboard/agents** | Lista de agentes (agents). |
| **GET /api/dashboard/channels** | Lista de canais (channels). |
| **GET /api/dashboard/costs** | Custos (costs). |
| **GET /api/dashboard/messages** | Mensagens (messages). |
| **GET /api/dashboard/prompts** | Prompts (prompts). |
| **GET /api/dashboard/clients** | Clientes (clients). |
| **POST /api/agent/message** | Persiste uso em **usage_logs** (channel_type, messages_sent, messages_received, etc.). |
| **POST /api/auth/login** | Valida admin em **admins** (email + hash de senha). |

Quando `DATABASE_URL` **não** está definida (ou Neon indisponível), essas rotas usam **dados simulados** (mock) e o sistema continua funcionando; `usage_logs` não é persistido e login admin usa mock (ver seção de auth).

---

## 4. Como validar que o Neon está conectado

**No terminal (backend rodando):**
- Com DATABASE_URL definida: ao subir o servidor, **não** deve aparecer a mensagem "Neon não conectado — usando dados simulados".
- Sem DATABASE_URL: deve aparecer "Neon não conectado — usando dados simulados".

**No browser ou curl:**
- **GET http://localhost:3000/health**  
  Resposta: `{ "status": "ok", "message": "Backend is running" }` (não indica Neon).
- **GET http://localhost:3000/api/health/db** (endpoint de saúde do banco)  
  Resposta esperada com Neon ok: `{ "database": "connected" }`.  
  Resposta sem Neon ou com erro: `{ "database": "disconnected" }` ou status 503.

**No código:**
- `isConnected()` (em `connection.js`) retorna `true` se `config.databaseUrl` estiver definida (não faz ping).
- `isDbConnected()` (async) faz um `SELECT 1` no banco e retorna `true`/`false`; use para validar conectividade real. O endpoint **GET /api/health/db** usa essa função.

---

## 5. Como testar no terminal e no browser

**Terminal:**
```bash
# Na pasta backend
cd backend

# Verificar se .env tem DATABASE_URL (não exibe o valor)
node -e "require('dotenv').config(); console.log('DATABASE_URL definida:', !!process.env.DATABASE_URL);"

# Subir o backend e observar o log de Neon
npm run dev
```

**Browser:**
1. Abra http://localhost:3000/health → deve retornar OK.
2. Abra http://localhost:3000/api/health/db → deve retornar `connected` ou `disconnected`.
3. Chame GET /api/dashboard/summary (com auth quando implementado); com Neon conectado e dados no banco, os números refletem os dados reais.

---

## 6. Aplicar o schema no Neon

1. No Neon Console, abra **SQL Editor**.
2. Execute, na ordem:
   - Conteúdo de **backend/db/schema.sql**
   - Conteúdo de **backend/db/schema-extensions.sql** (se existir)
   - Conteúdo de **backend/db/schema-admins.sql** (admins)
3. Confira se as tabelas aparecem em **Tables**.

**Admin inicial:** O `schema-admins.sql` insere um admin com email `admin@exemplo.com` e senha `admin123`. Se o login falhar (hash incorreto), gere um novo hash: `cd backend && node scripts/gen-admin-hash.js admin123` e atualize a coluna `password_hash` na tabela `admins` (ou o INSERT no arquivo e reexecute o schema).

---

## 7. Resiliência (fallback quando Neon cai)

- **Sem DATABASE_URL:** `getPool()` retorna `null`; serviços que checam `hasDb()`/`isConnected()` retornam mock; nenhuma query é executada.
- **Com DATABASE_URL mas banco indisponível:** As rotas que chamam `query()` podem lançar erro; os serviços do dashboard usam `try/catch` e, em caso de falha, retornam dados simulados para não derrubar o painel.
- **usage_logs:** Só é persistido quando `isConnected()` é true e a inserção em `usage_logs` não lança erro; em caso de erro, o log é registrado no console e a resposta da mensagem segue normalmente.

Assim, o sistema fica **pronto para produção** com Neon e, ao mesmo tempo, **resiliente** quando o banco não está configurado ou está fora do ar.
