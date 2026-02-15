# Backend – Agente IA Omni-Channel

Node.js + Express (ESM). Autenticação JWT para o painel admin. Banco PostgreSQL (Neon) com fallback para dados simulados.

---

## Como rodar o projeto

```bash
cd backend
cp .env.example .env
# Edite .env: PORT, DATABASE_URL, JWT_SECRET, OPENAI_API_KEY
npm install
npm run dev
```

Servidor sobe em **http://localhost:3000**. Endpoints principais:

- `GET /health` – saúde do servidor
- `GET /api/health/db` – saúde do Neon (connected / disconnected)
- `POST /api/auth/login` – login admin (email + senha)
- `GET /api/dashboard/*` – painel (exige JWT)
- `POST /api/agent/message` – mensagem do agente
- `GET /api/context` – contexto do canal/agente/prompt

---

## Configuração (variáveis de ambiente)

Centralizada em **`config/env.js`**. Validação e avisos no startup (nunca loga valores de secrets).

| Variável        | Obrigatório (produção) | Descrição                          |
|-----------------|------------------------|------------------------------------|
| `NODE_ENV`      | Recomendado            | `development` ou `production`      |
| `PORT`          | Não                    | Porta do servidor (padrão 3000)    |
| `DATABASE_URL`  | Sim (para dados reais) | Connection string do Neon          |
| `JWT_SECRET`    | Sim                    | Secret para assinatura do JWT      |
| `JWT_EXPIRES_IN`| Não                    | Ex.: `7d` (padrão)                 |
| `OPENAI_API_KEY`| Para agente IA         | Chave da OpenAI                    |

Sem `DATABASE_URL`: painel usa dados simulados; login admin mock (admin@exemplo.com / admin123).  
Sem `JWT_SECRET` em produção: o config loga aviso.

---

## Como configurar o Neon

1. Crie um projeto em [Neon Console](https://console.neon.tech).
2. Copie a **Connection string** (Pooled) para `DATABASE_URL` no `.env`.
3. No SQL Editor do Neon, execute na ordem:
   - `db/schema.sql`
   - `db/schema-extensions.sql`
   - `db/schema-admins.sql`
4. Detalhes: **`db/NEON.md`**.

---

## Como criar um admin

- **Sem Neon:** use `admin@exemplo.com` / `admin123` (mock).
- **Com Neon:** o `schema-admins.sql` insere um admin com email `admin@exemplo.com` e senha `admin123`.  
  Se o login falhar (hash incorreto), gere um novo hash:

  ```bash
  node scripts/gen-admin-hash.js admin123
  ```

  Atualize a coluna `password_hash` na tabela `admins` com o hash gerado.

---

## Seed inicial do dashboard (banco vazio)

Com Neon configurado e schemas aplicados, se as tabelas estiverem vazias o dashboard carrega com valores zerados e a mensagem "Nenhum agente cadastrado". Para criar a estrutura mínima (cliente, agente, canal WEB, prompt base):

```bash
cd backend
node scripts/seed-dashboard.js
```

Isso cria: **Cliente Inicial** (slug `cliente-inicial`), **Agente Principal** (slug `principal`), canal **WEB** e um prompt base. Idempotente: pode ser executado mais de uma vez.

---

## Estrutura de pastas

```
backend/
├── config/
│   └── env.js              # Variáveis de ambiente e validação
├── db/
│   ├── connection.js       # Pool Neon, getPool, query, isConnected, isDbConnected
│   ├── schema.sql
│   ├── schema-extensions.sql
│   ├── schema-admins.sql
│   └── NEON.md
├── middleware/
│   ├── channelContext.js   # Canal ativo (query/header), req.context
│   └── requireAdminAuth.js # JWT para /api/dashboard
├── routes/
│   ├── authRoutes.js
│   ├── dashboardRoutes.js
│   ├── contextRoutes.js
│   └── inboundRoutes.js
├── services/
│   ├── authService.js
│   ├── dashboardService.js
│   ├── contextService.js
│   ├── plansService.js     # Planos (preparação comercialização)
│   └── openaiService.js
├── repositories/
├── utils/
│   ├── errorResponses.js   # 401, 403, 400, 404, 500 padronizados
│   └── sanitize.js
├── scripts/
│   └── gen-admin-hash.js
└── server.js
```

---

## Como integrar novos canais

1. **Backend:** Canais válidos em `utils/sanitize.js` (`ALLOWED_CHANNELS`). Adicione o novo slug (ex.: `telegram`).
2. **Middleware:** `channelContext.js` já usa query `?channel=` e header `x-channel`; não precisa alterar para novo canal.
3. **Banco:** Tabela `channels` tem coluna `type` (string). Cadastre o canal para o agente com o mesmo tipo.
4. **Prompts:** Prompt por canal em `prompts` (channel_id preenchido). Regra: prompt do canal sobrescreve o base; fallback sempre para o base.
5. **Frontend:** No seletor de canal do painel, inclua a nova opção (ex.: Telegram).

---

## Segurança e boas práticas

- Nunca logar `JWT_SECRET`, `DATABASE_URL` ou senhas.
- Respostas de erro padronizadas: `utils/errorResponses.js` (401, 403, 400, 404, 500).
- Entradas sanitizadas: `utils/sanitize.js` (email, canal, string limitada).
- Em produção: defina `JWT_SECRET` forte e use HTTPS.
