# Arquitetura – Agente IA Omni-Channel (SaaS)

Sistema multi-cliente, multi-agente e multi-canal, pronto para comercialização e integração em qualquer site.

---

## 1. Estrutura de pastas

```
agente-ia-omnicanal/
├── backend/                        # Node.js + Express
│   ├── db/
│   │   ├── connection.js           # Pool Neon (getPool, query, isConnected); log se DATABASE_URL ausente
│   │   ├── schema.sql              # clients, agents, channels, prompts, messages, costs
│   │   ├── schema-extensions.sql   # usage_logs, plans, billing
│   │   ├── schema-admins.sql       # admins (login painel)
│   │   └── NEON.md                 # Caminho completo de integração Neon
│   ├── middleware/
│   │   ├── channelContext.js       # Canal ativo + client_id, agent_id em req.context; log [Canal ativo: X]
│   │   └── requireAdminAuth.js     # JWT obrigatório para /api/dashboard
│   ├── repositories/               # Acesso ao Neon (queries puras)
│   │   ├── clientsRepository.js
│   │   ├── agentsRepository.js
│   │   ├── channelsRepository.js
│   │   ├── promptsRepository.js
│   │   ├── messagesRepository.js
│   │   ├── costsRepository.js
│   │   └── usageLogsRepository.js
│   ├── services/                   # Regras de negócio
│   │   ├── openaiService.js
│   │   ├── dashboardService.js
│   │   └── contextService.js
│   ├── routes/
│   │   ├── inboundRoutes.js        # POST /api/agent/message
│   │   ├── authRoutes.js           # POST /api/auth/login
│   │   ├── dashboardRoutes.js      # GET /api/dashboard/* (protegido por JWT)
│   │   └── contextRoutes.js       # GET /api/context
│   └── server.js
├── frontend/
│   ├── admin/                      # React (Vite) – painel administrativo
│   │   ├── src/
│   │   │   ├── context/ChannelContext.jsx
│   │   │   ├── components/ChannelIndicator.jsx
│   │   │   ├── api/client.js       # ?channel= e header x-channel em toda chamada
│   │   │   └── pages/
│   │   └── package.json
│   ├── dashboard/                 # Painel vanilla (alternativo)
│   └── widget-chat.js             # Widget de chat para embed
└── ARCHITECTURE.md
```

Separação: **Frontend → API (rotas) → Services → Repositories → Neon**.

---

## 2. Fluxo do canal (obrigatório)

- **Ordem de identificação:** 1) query `?channel=` 2) header `x-channel` 3) fallback `web`.
- **Middleware:** `channelContext` em `/api`; anexa `req.context = { channel, client_id, agent_id }`.
- **Log em toda request:** `[Canal ativo: WEB] GET /api/...`
- **Frontend:** `ChannelContext` lê `?channel=` na carga; exibe "Canal ativo: X"; toda chamada envia `?channel=` e header `x-channel`.
- **Resposta da API:** header `x-channel-active` e, onde aplicável, corpo com `channel`.

---

## 3. Estratégia multi-tenant

- **clients** – inquilinos (comercialização).
- **agents** – por cliente (`client_id`).
- **channels** – por agente (`agent_id`).
- Requisições aceitam `client_id` e `agent_id` por query, body ou headers (`x-client-id`, `x-agent-id`).
- GET /api/context e POST /api/agent/message usam `req.context.client_id` e `req.context.agent_id`.

---

## 4. Uso e cobrança

- **usage_logs:** messages_sent, messages_received, tokens, estimated_cost, channel_type, recorded_at.
- **plans:** limits em JSONB por cliente.
- **billing:** period_start, period_end, amount, status (pending/paid/cancelled).
- POST /api/agent/message persiste uso (quando DATABASE_URL existe) em usage_logs por canal.

---

## 5. Integração Neon

- **Variável:** `DATABASE_URL` (connection string do Neon).
- **Arquivo:** `backend/db/connection.js` – `getPool()`, `query()`, `isConnected()`.
- Se `DATABASE_URL` não existir: `getPool()` retorna `null`, log **"Neon não conectado — usando dados simulados"**, e serviços usam dados mockados (dashboard, context).

---

## 6. Autenticação ADMIN (painel)

- **Tabela:** `admins` (schema-admins.sql) – email, password_hash (bcrypt), name.
- **Login:** POST /api/auth/login com `{ email, password }`; retorna `{ admin, token }` (JWT).
- **Proteção:** Todas as rotas `/api/dashboard/*` exigem header `Authorization: Bearer <token>` (middleware `requireAdminAuth`).
- **Sem Neon:** Login mock com admin@exemplo.com / admin123; token JWT válido para o painel.
- **JWT:** `JWT_SECRET` e `JWT_EXPIRES_IN` no `.env`; em produção usar secret forte (ex.: `openssl rand -hex 32`).

---

## 7. Segurança

- **Env:** Chaves e connection string apenas em `.env`; nunca no código.
- **CORS:** Configurado no Express; em produção restringir origem.
- **Validação:** Validar client_id/agent_id quando multi-tenant; validar canal no banco quando necessário.
- **Rate limit:** Em produção, considerar rate limit por client_id/agent_id.
- **HTTPS:** Usar HTTPS em produção; Neon usa SSL na connection string.

---

## 8. Integração externa (qualquer site)

O agente pode ser usado em qualquer site informando **client_id**, **agent_id** e **channel**.

### iframe

```html
<iframe
  src="https://seu-backend.com/embed?client_id=CLIENT_ID&agent_id=AGENT_ID&channel=web"
  width="400" height="600">
</iframe>
```

### Script embed

```html
<script
  src="https://seu-backend.com/agent.js"
  data-client="CLIENT_ID"
  data-agent="AGENT_ID"
  data-channel="web">
</script>
```

O script lê `data-channel` (fallback `web`) e envia em todas as requisições (`?channel=` e header `x-channel`).

### REST API

```http
POST /api/agent/message
Content-Type: application/json
x-channel: web
x-client-id: CLIENT_ID
x-agent-id: AGENT_ID

{ "text": "mensagem do usuário" }
```

Resposta: `{ "channel": "web", "response": "..." }` e header `x-channel-active`.

---

## 9. Endpoints principais

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | /api/auth/login | Login admin. Body: { email, password }. Retorna { admin, token }. Público. |
| GET | /api/health/db | Status do Neon: { database: "connected" \| "disconnected" }. Público. |
| GET | /api/context | client_id, agent_id, channel (do middleware), prompt_id, canal_nome. Header: x-channel-active |
| GET | /api/dashboard/summary | Resumo (custos, mensagens, status, alertas, porCanal). **Requer JWT** |
| GET | /api/dashboard/agents | Lista agentes (?client_id). **Requer JWT** |
| GET | /api/dashboard/channels | Lista canais (?agent_id). **Requer JWT** |
| GET | /api/dashboard/costs | Custos (?agent_id, period, from, to). **Requer JWT** |
| GET | /api/dashboard/messages | Mensagens (?agent_id, ?channel_id). **Requer JWT** |
| GET | /api/dashboard/prompts | Prompts (?agent_id). **Requer JWT** |
| GET | /api/dashboard/clients | Lista clientes. **Requer JWT** |
| POST | /api/agent/message | Mensagem. Corpo: text ou mensagem. Retorna { channel, response }. Header: x-channel-active. Persiste usage_logs quando Neon conectado |

---

## 10. Como confirmar o canal ativo

- **Backend (logs):** Em toda request `/api/*` aparece `[Canal ativo: WEB] GET /api/...` (ou o canal usado).
- **Browser (DevTools):** Na aba Network, em qualquer chamada para `/api/*`, verificar Query String (`?channel=web`) e Request Headers (`x-channel: web`); na resposta, header `x-channel-active`.
- **Frontend admin:** No topo do painel e no header da área principal: **"Canal ativo: WEB"** (ou o canal selecionado).

---

## 11. Como mudar o canal manualmente

1. **No painel React:** Usar o seletor "Canal ativo" no header e escolher outro canal (web, api, whatsapp, instagram). A URL e as requisições passam a usar o novo canal.
2. **Pela URL:** Abrir o painel com `?channel=api` (ex.: `http://localhost:5173/?channel=api`). O contexto lê o parâmetro e todas as chamadas usam `channel=api`.
3. **API direta:** Enviar `?channel=whatsapp` ou header `x-channel: whatsapp` nas requisições para o backend.
