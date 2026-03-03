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
import globalAdminRoutes from './routes/globalAdmin.routes.js';
import platformTenantsRoutes from './routes/platformTenants.routes.js';

import { channelContext, setChannelActiveHeader } from './middleware/channelContext.js';
import { agentOrAdminAuth } from './middleware/agentOrAdminAuth.js';

dotenv.config();



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

/* ---------- LOGIN DE AGENT (PÚBLICO DENTRO DA API) ---------- */
apiRouter.use('/agent', agentAuthRoutes);

/* ---------- TENANT PROTECTION ---------- */
apiRouter.use(requireTenant);

/* ---------- ROTAS MULTI-TENANT ---------- */

apiRouter.get('/agents', async (req, res) => {
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

apiRouter.use('/', evolutionWebhookRoutes);
apiRouter.use('/', contextRoutes);
apiRouter.use('/auth', authRoutes);
apiRouter.use('/dashboard', agentOrAdminAuth, dashboardRoutes);
apiRouter.use('/agents', agentOrAdminAuth, agentsRoutes);
apiRouter.use('/agent', inboundRoutes);

app.use('/api', apiRouter);

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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});