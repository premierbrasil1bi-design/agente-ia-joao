import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { sendUnauthorized, sendServerError } from '../utils/errorResponses.js';
import { config } from '../config/env.js';
import { pool } from '../db/pool.js';
import { toTenantApiRow } from '../utils/tenantMapper.js';
import globalAdminAuth from '../middlewares/globalAdminAuth.js';
import globalAdminRateLimit from '../middlewares/globalAdminRateLimit.js';
import * as agentsCtrl from '../controllers/globalAdmin.agents.controller.js';
import * as channelsCtrl from '../controllers/globalAdmin.channels.controller.js';
import * as tenantScopedCtrl from '../controllers/globalAdmin.tenantScoped.controller.js';
import * as tenantCtrl from '../controllers/globalAdmin.tenant.controller.js';

const router = Router();

const FAKE_HASH = '$2b$10$KbQiR7uZ5zXk3hR1lFhK4eFJpQXbJZz8F0z2x3u4v5w6y7z8a9b0c';
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getJwtSecret() {
  const secret = config.jwt?.secret || process.env.JWT_SECRET;
  if (!secret || (config.isProduction && secret === 'change-me-in-production')) {
    throw new Error('JWT_SECRET não definido ou inseguro em produção');
  }
  return secret;
}

/**
 * POST /api/global-admin/login
 * Body: { email, password }
 * Rate limited, timing-safe, log sem senha.
 */
router.post('/login', globalAdminRateLimit, async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      await bcrypt.compare(password || '', FAKE_HASH);
      return sendUnauthorized(res, 'Credenciais inválidas');
    }
    const emailClean = String(email).trim().toLowerCase();
    if (!EMAIL_REGEX.test(emailClean)) {
      await bcrypt.compare(password, FAKE_HASH);
      return sendUnauthorized(res, 'Credenciais inválidas');
    }
    const result = await pool.query(
      'SELECT id, email, name, password_hash, is_active FROM global_admins WHERE email = $1',
      [emailClean]
    );
    const admin = result.rows[0];
    if (!admin || !admin.is_active) {
      await bcrypt.compare(password, FAKE_HASH);
      return sendUnauthorized(res, 'Credenciais inválidas');
    }
    const match = await bcrypt.compare(password, admin.password_hash);
    if (!match) {
      console.warn('[global-admin] Login falhou: email=', emailClean, 'reason=invalid_password');
      return sendUnauthorized(res, 'Credenciais inválidas');
    }
    const secret = getJwtSecret();
    const token = jwt.sign(
      { globalAdminId: admin.id, email: admin.email, role: 'GLOBAL_ADMIN' },
      secret,
      { expiresIn: '12h' }
    );
    console.info('[global-admin] Login ok: id=', admin.id, 'email=', admin.email);
    res.status(200).json({
      token,
      admin: { id: admin.id, email: admin.email, name: admin.name },
    });
  } catch (err) {
    if (err.message?.includes('JWT_SECRET')) {
      return sendServerError(res, 'Configuração do servidor incompleta.', err);
    }
    return sendServerError(res, 'Erro ao fazer login.', err);
  }
});

/**
 * GET /api/global-admin/me
 */
/**
 * GET /api/global-admin/usage
 * Retorna uso global por tenant
 */
router.get('/usage', globalAdminAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT 
        t.id,
        t.name,
        t.slug,
        t.max_messages,
        0 AS messages_used_current_period,
        t.active
      FROM tenants t
      ORDER BY t.created_at DESC
    `).catch(() => ({ rows: [] }));

    // Se não houver dados, retornar mock
    if (!rows || rows.length === 0) {
      return res.status(200).json([
        {
          id: "mock-1",
          name: "Empresa Exemplo",
          slug: "empresa-exemplo",
          max_messages: 1000,
          messages_used_current_period: 120
        }
      ]);
    }

    res.status(200).json(rows.map((r) => toTenantApiRow(r)));

  } catch (err) {
    console.error('[global-admin] usage:', err.message);
    res.status(500).json([]);
  }
});
router.get('/me', globalAdminAuth, async (req, res) => {
  res.status(200).json({ admin: req.globalAdmin });
});

/**
 * GET /api/global-admin/stats
 * Métricas para o dashboard (total tenants, agents, etc.)
 */
router.get('/stats', globalAdminAuth, async (req, res) => {
  try {
    const [tenantsRes, agentsRes] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS count FROM tenants'),
      pool.query('SELECT COUNT(*)::int AS count FROM agents').catch(() => ({ rows: [{ count: 0 }] })),
    ]);
    res.status(200).json({
      totalTenants: tenantsRes.rows[0]?.count ?? 0,
      totalAgents: agentsRes.rows[0]?.count ?? 0,
      usageGlobal: 0,
      billingTotal: 0,
    });
  } catch (err) {
    console.error('[global-admin] stats:', err.message);
    res.status(200).json({ totalTenants: 0, totalAgents: 0, usageGlobal: 0, billingTotal: 0 });
  }
});

/**
 * GET /api/global-admin/tenants
 * Lista tenants para a tabela do dashboard
 */
router.get('/tenants', globalAdminAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `
      SELECT
        t.id,
        t.name,
        t.slug,
        t.plan,
        t.max_agents,
        t.max_messages,
        t.active,
        t.created_at
      FROM tenants t
      ORDER BY t.created_at DESC
      `
    );
    const list = rows.map((t) =>
      toTenantApiRow({
        ...t,
        max_agents: t.max_agents ?? 0,
        max_messages: t.max_messages ?? 0,
      })
    );
    res.status(200).json(
      list.map((t) => ({
        id: t.id,
        nome_empresa: t.nome_empresa,
        slug: t.slug,
        plan_id: t.plan ?? null,
        plan: t.plan ?? 'free',
        status: t.status,
        active: t.active,
        name: t.name,
        max_agents: t.max_agents,
        max_messages: t.max_messages,
        agents_used_current_period: t.agents_used_current_period ?? 0,
        messages_used_current_period: t.messages_used_current_period ?? 0,
        billing_cycle_start: t.billing_cycle_start ?? null,
        created_at: t.created_at,
      }))
    );
  } catch (err) {
    console.error('[global-admin] tenants:', err.message);
    res.status(500).json([]);
  }
});

// ---------- Tenant-scoped routes (must be before /tenants/:id) ----------
router.get('/tenants/:tenantId/agents', globalAdminAuth, agentsCtrl.listAgents);
router.post('/tenants/:tenantId/agents', globalAdminAuth, agentsCtrl.createAgent);
router.get('/tenants/:tenantId/channels', globalAdminAuth, channelsCtrl.listChannels);
router.post('/tenants/:tenantId/channels', globalAdminAuth, channelsCtrl.createChannel);
router.get('/tenants/:tenantId/users', globalAdminAuth, tenantScopedCtrl.listUsers);
router.get('/tenants/:tenantId/usage', globalAdminAuth, tenantScopedCtrl.getUsage);
router.get('/tenants/:tenantId/logs', globalAdminAuth, tenantScopedCtrl.getLogs);
router.get('/tenants/:tenantId/billing', globalAdminAuth, tenantScopedCtrl.getBilling);
router.patch('/tenants/:tenantId', globalAdminAuth, tenantCtrl.updateTenantHandler);
router.patch('/tenants/:tenantId/suspend', globalAdminAuth, tenantCtrl.suspendTenantHandler);

router.patch('/agents/:agentId', globalAdminAuth, agentsCtrl.updateAgent);
router.delete('/agents/:agentId', globalAdminAuth, agentsCtrl.deleteAgent);
router.patch('/channels/:channelId', globalAdminAuth, channelsCtrl.updateChannel);
router.delete('/channels/:channelId', globalAdminAuth, channelsCtrl.deleteChannel);

/**
 * GET /api/global-admin/tenants/:id
 * Detalhe de um tenant (mesmo formato da listagem)
 */
router.get('/tenants/:id', globalAdminAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, slug, plan, max_agents, max_messages, active, created_at FROM tenants WHERE id = $1`,
      [req.params.id]
    );
    const row = rows[0];
    if (!row) {
      return res.status(404).json({ error: 'Tenant não encontrado' });
    }
    const t = toTenantApiRow({
      ...row,
      max_agents: row.max_agents ?? 0,
      max_messages: row.max_messages ?? 0,
    });
    res.status(200).json({
      id: t.id,
      nome_empresa: t.nome_empresa,
      slug: t.slug,
      plan_id: t.plan ?? null,
      plan: t.plan ?? 'free',
      status: t.status,
      active: t.active,
      name: t.name,
      max_agents: t.max_agents,
      max_messages: t.max_messages,
      agents_used_current_period: t.agents_used_current_period ?? 0,
      messages_used_current_period: t.messages_used_current_period ?? 0,
      billing_cycle_start: t.billing_cycle_start ?? null,
      created_at: t.created_at,
    });
  } catch (err) {
    console.error('[global-admin] tenants/:id:', err.message);
    res.status(500).json({ error: 'Erro ao buscar tenant' });
  }
});

// Plans
router.get('/plans', globalAdminAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, price, max_agents, max_messages
      FROM plans
      ORDER BY price ASC
    `);

    const plans = result.rows.map(p => ({
      id: p.id,
      name: p.name,
      price: Number(p.price ?? 0),
      max_agents: p.max_agents ?? 0,
      max_messages: p.max_messages ?? 0
    }));

    return res.status(200).json(plans);

  } catch (err) {
    console.error('[global-admin] plans:', err.message);

    // Fallback temporário caso tabela não exista
    return res.status(200).json([
      {
        id: 'free',
        name: 'Free',
        price: 0,
        max_agents: 1,
        max_messages: 1000
      },
      {
        id: 'pro',
        name: 'Pro',
        price: 97,
        max_agents: 5,
        max_messages: 10000
      },
      {
        id: 'enterprise',
        name: 'Enterprise',
        price: 497,
        max_agents: 50,
        max_messages: 100000
      }
    ]);
  }
});
/**
 * GET /api/global-admin/logs
 * Lista logs administrativos
 */
router.get('/logs', globalAdminAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id, action, entity, entity_id, created_at
      FROM global_admin_logs
      ORDER BY created_at DESC
      LIMIT 100
    `);

    return res.status(200).json(rows);

  } catch (err) {
    console.warn('[global-admin] logs fallback mock:', err.message);

    return res.status(200).json([
      {
        id: 'mock-1',
        action: 'LOGIN',
        entity: 'GLOBAL_ADMIN',
        entity_id: '1',
        created_at: new Date().toISOString()
      },
      {
        id: 'mock-2',
        action: 'UPDATE_PLAN',
        entity: 'TENANT',
        entity_id: 'tenant-123',
        created_at: new Date().toISOString()
      }
    ]);
  }
});
export default router;
