// ================= IMPORTS =================

import dotenv from 'dotenv';
import './bootstrap/dns-ipv4first.js';
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import jwt from 'jsonwebtoken';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';

import { config, validateChannelProvidersConfig } from './config/env.js';
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
import messagesRoutes from './routes/messages.routes.js';
import alertsRoutes from './routes/alerts.routes.js';
import providersRoutes from './routes/providers.routes.js';
import globalAdminAuth from './middlewares/globalAdminAuth.js';
import { channelContext, setChannelActiveHeader } from './middleware/channelContext.js';
import { correlationIdMiddleware } from './middleware/correlationId.middleware.js';
import { startChannelMonitor } from './services/channelMonitor.service.js';
import { agentAuth } from './middleware/agentAuth.js';
import { getRedisConnection, getRedisUrl, initEvolutionQueueInfra } from './queues/evolution.queue.js';
import { startEvolutionWorker } from './workers/evolution.worker.js';
import { runChannelsSchemaGuard } from './services/channelsSchemaGuard.service.js';
import * as evolutionService from './services/evolutionService.js';
import { checkProviderHealth, getProvidersHealthSnapshot } from './services/providerHealth.service.js';
import { invalidateProviderHealthCache } from './services/providerHealth.service.js';
import { logAdminAction } from './services/adminActionsLog.service.js';
import { getProviderHealthSnapshot } from './services/providerOrchestrator.service.js';
import { getTenantById } from './repositories/tenant.repository.js';
import { filterAllowedProvidersForTenant, getAllowedProviders } from './utils/tenantAllowedProviders.js';
import { startWahaQrLogCapture } from './services/wahaQrCapture.js';

dotenv.config();

const WAHA_API_URL = process.env.WAHA_API_URL || null;

if (!WAHA_API_URL) {
  console.warn('[WAHA] Não configurado, integração desativada');
}

console.log('[BOOT] WAHA:', WAHA_API_URL || 'NOT CONFIGURED');
console.log('[BOOT] REDIS:', process.env.REDIS_HOST || 'MISSING');
console.log('[BOOT] DATABASE:', process.env.DATABASE_URL ? 'OK' : 'MISSING');
console.log('[REDIS CONFIG]', {
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
});

validateChannelProvidersConfig();

process.on('unhandledRejection', console.error);
process.on('uncaughtException', console.error);

const app = express();
const PORT = config.port || 3000;

const corsAllowedOrigins = [
  'https://app.omnia1biai.com.br',
  'https://admin.omnia1biai.com.br',
];

if (process.env.NODE_ENV !== 'production') {
  corsAllowedOrigins.push('http://localhost:5173');
  corsAllowedOrigins.push('http://localhost:3000');
}

const corsAllowedHeaders = [
  'Content-Type',
  'Authorization',
  'apikey',
  'x-channel',
  'x-correlation-id',
  'x-tenant-id',
  'x-request-id',
  'x-trace-id',
];

const corsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true);

    if (corsAllowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    console.error('[CORS] Not allowed:', origin);
    return callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: corsAllowedHeaders,
  credentials: true,
};

// 1) CORS (antes de body parser e rotas)
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// 2) Debug CORS / preflight (temporário — remover ou reduzir em produção se muito barulho)
app.use((req, res, next) => {
  console.log('[CORS]', req.method, req.path, req.headers.origin);
  next();
});

// 3) Log de requisições (antes das rotas)
app.use((req, res, next) => {
  console.log(`[REQ] ${req.method} ${req.url}`);
  next();
});

// 4) Body parser (antes das rotas)
app.use(express.json());
app.use(correlationIdMiddleware);

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

app.get('/api/health/providers', async (req, res) => {
  try {
    const providers = await getProvidersHealthSnapshot();
    return res.status(200).json({
      success: true,
      providers,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[PROVIDER HEALTH] snapshot error:', err?.message || err);
    return res.status(200).json({
      success: true,
      providers: {},
      timestamp: new Date().toISOString(),
    });
  }
});

app.post('/api/health/providers/:provider/reconnect', globalAdminAuth, async (req, res) => {
  const provider = String(req.params.provider || '').toLowerCase().trim();
  const rawRole = String(req.globalAdmin?.role || '').toUpperCase();
  const mappedRole = rawRole === 'GLOBAL_ADMIN' ? 'SUPER_ADMIN' : rawRole;
  const allowedRoles = new Set(['SUPER_ADMIN', 'SUPPORT']);
  if (!allowedRoles.has(mappedRole)) {
    await logAdminAction({
      action: 'PROVIDER_RECONNECT',
      entity: 'provider',
      entityId: provider,
      metadata: { provider, context: 'providers_panel' },
      performedBy: req.globalAdmin?.id,
      role: mappedRole,
      status: 'error',
      message: 'FORBIDDEN',
    });
    return res.status(403).json({ success: false, error: 'FORBIDDEN' });
  }

  try {
    if (!provider) {
      throw new Error('Provider inválido.');
    }
    invalidateProviderHealthCache(provider);
    await checkProviderHealth(provider);
    await logAdminAction({
      action: 'PROVIDER_RECONNECT',
      entity: 'provider',
      entityId: provider,
      metadata: { provider, context: 'providers_panel' },
      performedBy: req.globalAdmin?.id,
      role: mappedRole,
      status: 'success',
      message: 'Reconexão iniciada',
    });
    return res.status(200).json({ success: true, message: 'Reconexão iniciada' });
  } catch (err) {
    await logAdminAction({
      action: 'PROVIDER_RECONNECT',
      entity: 'provider',
      entityId: provider,
      metadata: { provider, context: 'providers_panel' },
      performedBy: req.globalAdmin?.id,
      role: mappedRole,
      status: 'error',
      message: err?.message || 'Falha ao reconectar',
    });
    return res.status(500).json({ success: false, error: err?.message || 'Falha ao reconectar provider' });
  }
});

app.get('/api/providers/health', globalAdminAuth, async (req, res) => {
  try {
    const tenantId = String(req.query?.tenantId || '').trim() || null;
    const health = getProviderHealthSnapshot();
    const base = {
      providerHealthStore: health,
      computedAt: new Date().toISOString(),
    };
    if (!tenantId) return res.status(200).json(base);
    const tenant = await getTenantById(tenantId);
    if (!tenant) return res.status(404).json({ error: 'Tenant não encontrado.' });
    const trackedProviders = Object.keys(health);
    const allowedProviders = getAllowedProviders(tenant);
    const availableProviders = filterAllowedProvidersForTenant(tenant, trackedProviders);
    return res.status(200).json({
      ...base,
      tenantId,
      allowedProviders,
      availableProviders,
    });
  } catch (err) {
    console.error('[providers] health:', err.message);
    return res.status(500).json({ error: 'Erro ao obter health de providers.' });
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
agentRouter.use('/messages', messagesRoutes);
agentRouter.use('/alerts', alertsRoutes);
agentRouter.use('/providers', providersRoutes);
agentRouter.use('/agents', agentsRoutes);
agentRouter.use(contextRoutes);
agentRouter.use(inboundRoutes);

apiRouter.use('/agent', agentRouter);

/* ---------- ROTAS /api/agents, /api/channels, /api/context (Client App, com auth) ---------- */
apiRouter.use('/agents', agentAuth, requireTenant, agentsRoutes);
/* Conexão WhatsApp (Evolution): /channels/:id/connect, qrcode, status, disconnect – antes das rotas CRUD */
apiRouter.use('/channels', agentAuth, requireTenant, channelConnectionRoutes);
apiRouter.use('/channels', agentAuth, requireTenant, channelsRoutes);
apiRouter.use('/messages', agentAuth, requireTenant, messagesRoutes);
apiRouter.use('/alerts', agentAuth, requireTenant, alertsRoutes);
apiRouter.use('/providers', agentAuth, requireTenant, providersRoutes);
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
    origin: corsAllowedOrigins,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: corsAllowedHeaders,
    credentials: true,
  },
});

// Disponibiliza io globalmente para emissão de eventos de status de canais
// (ex.: logger.statusChange, monitor de canais, etc.).
globalThis.io = io;

startWahaQrLogCapture();

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

  socket.on('channel:subscribe', (payload = {}, ack) => {
    const authenticated = String(socket.data?.tenantId || '').trim();
    const channelId = String(payload?.channelId || '').trim();
    const tenantId = String(payload?.tenantId || '').trim();
    if (!authenticated || !channelId || !tenantId || authenticated !== tenantId) {
      if (typeof ack === 'function') ack({ ok: false, error: 'CHANNEL_FORBIDDEN' });
      return;
    }
    socket.join(`channel:${channelId}`);
    if (typeof ack === 'function') ack({ ok: true, channelId });
  });

  socket.on('message:typing', (payload = {}, ack) => {
    const authenticated = String(socket.data?.tenantId || '').trim();
    const tenantId = String(payload?.tenantId || '').trim();
    const channelId = String(payload?.channelId || '').trim();
    const participantId = String(payload?.participantId || payload?.contact || '').trim();
    const isTyping = Boolean(payload?.isTyping);
    if (!authenticated || !tenantId || authenticated !== tenantId || !channelId || !participantId) {
      if (typeof ack === 'function') ack({ ok: false, error: 'TYPING_FORBIDDEN' });
      return;
    }
    const out = {
      channelId,
      channelType: String(payload?.channelType || 'unknown'),
      conversationId: String(payload?.conversationId || `${channelId}:${participantId}`),
      participantId,
      contact: participantId,
      tenantId,
      isTyping,
      sourceSocketId: socket.id,
    };
    io.to(tenantRoom(tenantId)).emit('message:typing', out);
    io.to(`channel:${channelId}`).emit('message:typing', out);
    if (typeof ack === 'function') ack({ ok: true });
  });
});

// O HTTP deve subir e responder mesmo se infra assíncrona (Redis/BullMQ) estiver indisponível.
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server rodando na porta ${PORT}`);
  (async () => {
    try {
      await pool.query('SELECT 1');
      console.log('[DB] Connected successfully');
    } catch (err) {
      console.error('[DB] Connection failed:', err?.message || err);
    }
  })();
  startChannelMonitor();
  (async () => {
    try {
      await checkProviderHealth('waha');
      console.log('[PROVIDER HEALTH] WAHA ok');
    } catch (e) {
      console.error('[PROVIDER HEALTH] WAHA error:', e?.message || e);
    }
  })();
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