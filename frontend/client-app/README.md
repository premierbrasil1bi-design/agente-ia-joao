# Agent Admin – Painel do Agente IA Omni-Channel

Painel administrativo (React + Vite) para gerenciar o agente de IA conversacional multi-canal e multi-cliente.

---

## Como rodar o admin

```bash
cd frontend/admin
npm install
npm run dev
```

O painel abre em **http://localhost:5173** (porta padrão do Vite). Na primeira visita você será redirecionado para **/login**.

---

## Login (autenticação ADMIN)

- **Sem Neon:** use `admin@exemplo.com` / `admin123` (login mock).
- **Com Neon:** use o admin criado no schema (`schema-admins.sql`), por padrão `admin@exemplo.com` / `admin123` (trocar em produção).
- O token JWT é enviado automaticamente em todas as requisições ao dashboard (`Authorization: Bearer <token>`).
- Para sair: botão **Sair** no header.

---

## Porta

- **5173** – dev server do Vite (frontend/admin).
- O backend deve estar em **http://localhost:3000** (proxy configurado em `vite.config.js`: `/api` → `localhost:3000`).

---

## Como confirmar o canal ativo no browser

1. Abra as **DevTools** (F12) → aba **Network**.
2. Recarregue a página ou troque o canal no seletor.
3. Clique em qualquer requisição para **localhost:3000** (ou para `/api/...`).
4. **Request:**
   - **Query String:** deve ter `channel=web` (ou api, whatsapp, instagram).
   - **Headers:** deve ter `x-channel: web` (ou o canal selecionado).
5. **Response → Headers:** deve ter `x-channel-active: WEB` (ou o canal em UPPERCASE).

---

## URLs de exemplo

- **Canal WEB (padrão):** http://localhost:5173/?channel=web  
- **Canal API:** http://localhost:5173/?channel=api  
- **Canal WHATSAPP:** http://localhost:5173/?channel=whatsapp  
- **Canal INSTAGRAM:** http://localhost:5173/?channel=instagram  

Ao mudar o canal no seletor da barra superior, a URL é atualizada com `?channel=...` e as chamadas à API passam a usar esse canal.

---

## Funcionamento sem Neon

O painel funciona **100% com dados simulados** quando o backend não tem `DATABASE_URL` (Neon não conectado). Dashboard, Contexto do Agente e Prompts carregam mocks; não é necessário banco para desenvolvimento ou demonstração.
