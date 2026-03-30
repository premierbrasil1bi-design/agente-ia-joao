// ================= IMPORTS =================

import './bootstrap/dns-ipv4first.js';
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import jwt from 'jsonwebtoken';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';

import { config } from './config/env.js';
import { isDbConnected } from './db/connection.js';
import { pool } from './db/pool.js';
import { requireTenant } from './middleware/requireTenant.js';
import { sendNotFound } from './utils/errorResponses.js';

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
import evolutionGatewayRoutes from './routes/evolutionGateway.routes.js';
import evolutionIngressRoutes from './routes/evolutionIngress.routes.js';
import wahaWebhookRoutes from './routes/wahaWebhook.routes.js';
import { getEvolutionApiKey } from './services/evolutionHttp.client.js';

import { channelContext, setChannelActiveHeader } from './middleware/channelContext.js';
import { startChannelMonitor } from './services/channelMonitor.service.js';
import { agentAuth } from './middleware/agentAuth.js';
import { getRedisConnection, getRedisUrl, initEvolutionQueueInfra } from './queues/evolution.queue.js';
import { startEvolutionWorker } from './workers/evolution.worker.js';
import { runChannelsSchemaGuard } from './services/channelsSchemaGuard.service.js';
import * as evolutionService from './services/evolutionService.js';

console.log('[ENV] REDIS:', process.env.REDIS_HOST || 'MISSING');
console.log('[ENV] DATABASE:', process.env.DATABASE_URL ? 'OK' : 'MISSING');
console.log('[REDIS CONFIG]', {
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
});

if ((process.env.EVOLUTION_API_URL || process.env.EVOLUTION_URL || '').trim()) {
  try {
    getEvolutionApiKey();
  } catch (e) {
    console.error('[EVOLUTION] startup: EVOLUTION_API_URL definida mas EVOLUTION_API_KEY ausente ou inválida.');
    console.error('[EVOLUTION]', e.message);
    process.exit(1);
  }
}

process.on('unhandledRejection', console.error);
process.on('uncaughtException', console.error);

const app = express();
const PORT = config.port || 3000;

const allowedOrigins = [
  'https://admin.omnia1biai.com.br',
  'https://app.omnia1biai.com.br',
  'http://localhost:5173',
  'http://localhost:3000',
];

const corsOptions = {
  origin: (origin, callback) => {
    console.log('[CORS] Origin:', origin);
    // Permite requests sem Origin (ex.: health checks, curl, server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    console.error('CORS bloqueado:', origin);
    return callback(new Error('CORS bloqueado'), false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Origin',
    'X-Requested-With',
    'Content-Type',
    'Accept',
    'Authorization',
    'apikey',
    'x-channel',
  ],
};

// 1) CORS (antes de body parser e rotas)
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// 2) Log de requisições (antes das rotas)
app.use((req, res, next) => {
  console.log(`[REQ] ${req.method} ${req.url}`);
  next();
});

// 3) Body parser (antes das rotas)
app.use(express.json());

// 4) Fallback de headers CORS (apenas se algo acima não aplicar)
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowOrigin = allowedOrigins.includes(origin) ? origin : 'https://app.omnia1biai.com.br';
  res.header('Access-Control-Allow-Origin', allowOrigin);
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept, Authorization, apikey, x-channel'
  );
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  next();
});

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

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
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
apiRouter.use('/evolution', evolutionIngressRoutes);
apiRouter.use('/evolution', evolutionGatewayRoutes);
apiRouter.use('/context', agentAuth, requireTenant, agentContextRoutes);

/* ---------- OUTRAS ROTAS DA API ---------- */
apiRouter.use('/', evolutionWebhookRoutes);
apiRouter.use('/auth', authRoutes);

/* ---------- WEBHOOKS (WAHA) — rota pública (sem auth) ---------- */
app.use('/api/channels', wahaWebhookRoutes);

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
  console.error('Erro global:', err);

  if (res.headersSent) {
    return next(err);
  }

  res.status(500).json({ error: 'Erro interno' });
});

/* =========================================================
   SERVER START
========================================================= */

const server = createServer(app);

const io = new SocketIOServer(server, {
  cors: {
    origin: [
      'https://app.omnia1biai.com.br',
      'https://admin.omnia1biai.com.br',
      'http://localhost:5173',
      'http://localhost:3000',
    ],
    methods: ['GET', 'POST'],
    credentials: true
  },
});

// Disponibiliza io globalmente para emissão de eventos de status de canais
// (ex.: logger.statusChange, monitor de canais, etc.).
globalThis.io = io;

const SOCKET_TENANT_ROOM_PREFIX = 'tenant:';
const tenantRoom = (tenantId) => `${SOCKET_TENANT_ROOM_PREFIX}${tenantId}`;
const SUBSCRIBE_RATE_LIMIT_PER_MIN = 20;

function parseSocketToken(socket) {
  const authToken = socket.handshake?.auth?.token;
  if (authToken && String(authToken).trim()) return String(authToken).trim();
  const header = socket.handshake?.headers?.authorization;
  if (!header) return '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return String(header).trim();
}

function extractTenantIdFromDecoded(decoded) {
  return decoded?.tenantId ?? decoded?.tenant_id ?? null;
}

async function canSubscribeSocket(socket) {
  const redis = globalThis.redisMain || null;
  if (!redis) return true;
  const tenantId = String(socket.data?.tenantId || '').trim();
  const socketId = String(socket.id || '').trim();
  if (!tenantId || !socketId) return false;
  const key = `socket:subscribe:rl:${tenantId}:${socketId}`;
  try {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 60);
    return count <= SUBSCRIBE_RATE_LIMIT_PER_MIN;
  } catch {
    return true;
  }
}

io.use((socket, next) => {
  try {
    const token = parseSocketToken(socket);
    if (!token) return next(new Error('SOCKET_UNAUTHORIZED'));
    const secret = config.agentJwt?.secret;
    if (!secret) return next(new Error('SOCKET_SERVER_MISCONFIG'));
    const decoded = jwt.verify(token, secret);
    const tenantId = extractTenantIdFromDecoded(decoded);
    if (!tenantId || String(tenantId).trim() === '') return next(new Error('SOCKET_TENANT_MISSING'));
    socket.data.user = decoded;
    socket.data.tenantId = String(tenantId).trim();
    return next();
  } catch {
    return next(new Error('SOCKET_UNAUTHORIZED'));
  }
});

io.on('connection', (socket) => {
  console.log('[socket.io] Cliente conectado', socket.id);
  const tenantId = socket.data?.tenantId ? String(socket.data.tenantId) : '';
  if (tenantId) {
    socket.join(tenantRoom(tenantId));
    socket.emit('channels:subscribed', { tenantId });
  }

  socket.on('channels:subscribe', async (payload = {}, ack) => {
    const incoming = String(payload?.tenantId || '').trim();
    const authenticated = String(socket.data?.tenantId || '').trim();
    if (!incoming || !authenticated || incoming !== authenticated) {
      if (typeof ack === 'function') ack({ ok: false, error: 'TENANT_FORBIDDEN' });
      return;
    }
    if (!(await canSubscribeSocket(socket))) {
      if (typeof ack === 'function') ack({ ok: false, error: 'RATE_LIMITED' });
      return;
    }
    socket.join(tenantRoom(authenticated));
    if (typeof ack === 'function') ack({ ok: true, tenantId: authenticated });
  });
});

// O HTTP deve subir e responder mesmo se infra assíncrona (Redis/BullMQ) estiver indisponível.
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server rodando na porta ${PORT}`);
  startChannelMonitor();
});

(async () => {
  try {
    globalThis.redisMain = getRedisConnection();
    const redisUrl = getRedisUrl();
    try {
      const pubClient = createClient({ url: redisUrl });
      const subClient = pubClient.duplicate();
      await pubClient.connect();
      await subClient.connect();
      io.adapter(createAdapter(pubClient, subClient));
      console.log('[socket.io] Redis adapter ativo');
    } catch (e) {
      console.warn('[socket.io] Redis adapter indisponível, seguindo em modo single-instance:', e?.message || e);
    }

    await initEvolutionQueueInfra();
    if (process.env.EVOLUTION_WORKER_IN_PROCESS !== 'false') {
      startEvolutionWorker();
    } else {
      console.warn(
        '[server] EVOLUTION_WORKER_IN_PROCESS=false — worker BullMQ deve estar no PM2 (worker-evolution).'
      );
    }
    await runChannelsSchemaGuard();
  } catch (err) {
    console.error('[server] Falha ao inicializar infra Redis/BullMQ (servidor HTTP segue ativo):', err?.message || err);
  }
})();