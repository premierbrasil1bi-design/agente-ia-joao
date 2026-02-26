
// ================= IMPORTS =================
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import { config } from './config/env.js';
import { isDbConnected } from './db/connection.js';
import { pool } from './db/pool.js';
import { requireTenant } from './middleware/requireTenant.js';
import { sendNotFound, sendServerError } from './utils/errorResponses.js';

import contextRoutes from './routes/contextRoutes.js';
import evolutionWebhookRoutes from './routes/evolutionWebhook.routes.js';
import authRoutes from './routes/authRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';
import agentsRoutes from './routes/agentsRoutes.js';
import agentAuthRoutes from './routes/agentAuth.routes.js';
import inboundRoutes from './routes/inboundRoutes.js';
import tenantUsageRoutes from './routes/tenantUsage.routes.js';
import adminTenantRoutes from './routes/admin/tenant.routes.js';
import { channelContext, setChannelActiveHeader } from './middleware/channelContext.js';
import { agentOrAdminAuth } from './middleware/agentOrAdminAuth.js';

// =============== ENV SETUP ================
dotenv.config();

// =============== APP INIT ================
const app = express();
const PORT = config.port || 3000;

// ========== GLOBAL MIDDLEWARES ============
app.use(cors({
  origin: [
    'https://www.omnia1biai.com.br',
    'https://omnia1biai.com.br'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'x-channel'
  ],
  credentials: true
}));
app.options('*', cors());
app.use(express.json());

// =============== ADMIN MASTER TENANTS CRUD ===============
app.use('/admin/tenants', adminTenantRoutes);

// =============== TENANT USAGE ENDPOINT ===============
app.use('/api/tenant', tenantUsageRoutes);

// ========== CANAL MIDDLEWARES ============
app.use('/api', channelContext);
app.use('/api', setChannelActiveHeader);

// =============== HEALTH ===================
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

// =============== ROTAS PÚBLICAS ===============
app.use('/api/agent', agentAuthRoutes); // login público

// =============== ROTAS PROTEGIDAS ===============
app.use(requireTenant);

// Exemplo multi-tenant
app.get('/agents', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM agents WHERE tenant_id = $1',
      [req.tenantId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'AGENTS_FETCH_ERROR' });
  }
});

// Demais rotas protegidas
app.use('/api', evolutionWebhookRoutes);
app.use('/api', contextRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/dashboard', agentOrAdminAuth, dashboardRoutes);
app.use('/api/agents', agentOrAdminAuth, agentsRoutes);
app.use('/api/agent', inboundRoutes);
app.use('/', inboundRoutes);

// ============= 404 HANDLER ================
app.use((req, res) => sendNotFound(res, 'Rota não encontrada.'));

// =========== ERROR HANDLER ================
app.use((err, req, res, next) => {
  const msg = err?.message || String(err);
  console.error('[API error]', msg);
  const clientMsg =
    config.env !== 'production' && msg ? msg : 'Erro interno do servidor.';
  sendServerError(res, clientMsg, err);
});

// =============== SERVER ===================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});