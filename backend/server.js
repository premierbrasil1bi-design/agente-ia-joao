// ================= IMPORTS =================

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';

import { config } from './config/env.js';
import { isDbConnected } from './db/connection.js';
import { pool } from './db/pool.js';
import { requireTenant } from './middleware/requireTenant.js';
import { sendNotFound, sendServerError, sendBadRequest } from './utils/errorResponses.js';

import contextRoutes from './routes/contextRoutes.js';
import evolutionWebhookRoutes from './routes/evolutionWebhook.routes.js';
import authRoutes from './routes/authRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';
import agentsRoutes from './routes/agentsRoutes.js';
import channelsRoutes from './routes/channelsRoutes.js';
import channelConnectionRoutes from './routes/channelConnection.routes.js';
import agentAuthRoutes from './routes/agentAuth.routes.js';
import inboundRoutes from './routes/inboundRoutes.js';
import tenantUsageRoutes from './routes/tenantUsage.routes.js';
import adminTenantRoutes from './routes/admin/tenant.routes.js';
import globalAdminRoutes from './routes/globalAdmin.routes.js';
import tenantUsersRoutes from './routes/tenantUsers.routes.js';
import platformTenantsRoutes from './routes/platformTenants.routes.js';
import agentContextRoutes from './routes/agentContext.routes.js';
import webhooksRoutes from './routes/webhooks.routes.js';

import { channelContext, setChannelActiveHeader } from './middleware/channelContext.js';
import { startChannelMonitor } from './services/channelMonitor.service.js';
import { agentAuth } from './middleware/agentAuth.js';

const app = express();
const PORT = config.port || 3000;

const allowedOrigins = [
  'https://admin.omnia1biai.com.br',
  'https://app.omnia1biai.com.br'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS: ' + origin));
    }
  },
  credentials: true
}));

app.options('*', cors());

app.use(express.json());

/* =========================================================
   GLOBAL MIDDLEWARES
========================================================= */


// ...existing code...

/* =========================================================
   HEALTH CHECK (GLOBAL)
========================================================= */

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'Backend is running' });
});

app.get('/api/health/db', async (req, res) => {
  try {
    const connected = await isDbConnected();
    res.status(200).json({ database: connected ? 'connected' : 'disconnected' });
  } catch {
    res.status(503).json({ database: 'disconnected', error: 'Unavailable' });
  }
});

/* =========================================================
   GLOBAL ADMIN (NÃO USA TENANT, NÃO USA CANAL)
========================================================= */

app.use('/api/global-admin', globalAdminRoutes);
app.use('/api/tenant-users', tenantUsersRoutes);

/* =========================================================
   PLATFORM TENANTS (GLOBAL ADMIN, SEM TENANT)
========================================================= */

app.use('/api/platform', platformTenantsRoutes);

/* =========================================================
   ADMIN MASTER TENANTS (GLOBAL)
========================================================= */

app.use('/admin/tenants', adminTenantRoutes);

/* =========================================================
   TENANT USAGE (PODE SER GLOBAL)
========================================================= */

app.use('/api/tenant', tenantUsageRoutes);

/* =========================================================
   API MULTI-TENANT ENCAPSULADA
========================================================= */

const apiRouter = express.Router();

/* ---------- CANAL ---------- */
apiRouter.use(channelContext);
apiRouter.use(setChannelActiveHeader);

/* ---------- CLIENT APP: todas as rotas autenticadas sob /api/agent/* ---------- */
const agentRouter = express.Router();
agentRouter.use('/auth', agentAuthRoutes);
agentRouter.use(agentAuth);
agentRouter.use(requireTenant);
agentRouter.use('/dashboard', dashboardRoutes);
agentRouter.use('/channels', channelConnectionRoutes);
agentRouter.use('/channels', channelsRoutes);
agentRouter.use('/agents', agentsRoutes);
agentRouter.use(contextRoutes);
agentRouter.use(inboundRoutes);

apiRouter.use('/agent', agentRouter);

/* ---------- ROTAS /api/agents, /api/channels, /api/context (Client App, com auth) ---------- */
apiRouter.use('/agents', agentAuth, requireTenant, agentsRoutes);
/* Conexão WhatsApp (Evolution): /channels/:id/connect, qrcode, status, disconnect – antes das rotas CRUD */
apiRouter.use('/channels', agentAuth, requireTenant, channelConnectionRoutes);
apiRouter.use('/channels', agentAuth, requireTenant, channelsRoutes);
apiRouter.use('/context', agentAuth, requireTenant, agentContextRoutes);

/* ---------- OUTRAS ROTAS DA API ---------- */
apiRouter.use('/', evolutionWebhookRoutes);
apiRouter.use('/auth', authRoutes);

app.use('/api', apiRouter);

/* ---------- WEBHOOKS (Evolution) ---------- */
app.use('/webhooks', webhooksRoutes);

/* =========================================================
   ROOT INBOUND (SE NECESSÁRIO)
========================================================= */

app.use('/', inboundRoutes);

/* =========================================================
   404
========================================================= */

app.use((req, res) => sendNotFound(res, 'Rota não encontrada.'));

/* =========================================================
   ERROR HANDLER
========================================================= */

app.use((err, req, res, next) => {
  const msg = err?.message || String(err);
  console.error('[API error]', msg);

  const clientMsg =
    config.env !== 'production' && msg
      ? msg
      : 'Erro interno do servidor.';

  sendServerError(res, clientMsg, err);
});

/* =========================================================
   SERVER START
========================================================= */

const server = createServer(app);

const io = new SocketIOServer(server, {
  cors: {
    origin: '*',
  },
});

// Disponibiliza io globalmente para emissão de eventos de status de canais
// (ex.: logger.statusChange, monitor de canais, etc.).
globalThis.io = io;

io.on('connection', (socket) => {
  console.log('[socket.io] Cliente conectado', socket.id);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  startChannelMonitor();
});