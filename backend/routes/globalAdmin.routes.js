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
import * as adminsRepo from '../repositories/adminsRepository.js';

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

function parseRange(rangeRaw) {
  const val = String(rangeRaw || '24h').toLowerCase().trim();
  if (val === '1h') return { label: '1h', ms: 60 * 60 * 1000, minutes: 60 };
  if (val === '7d') return { label: '7d', ms: 7 * 24 * 60 * 60 * 1000, minutes: 7 * 24 * 60 };
  return { label: '24h', ms: 24 * 60 * 60 * 1000, minutes: 24 * 60 };
}

function collectDatesForRange(rangeCfg) {
  const now = Date.now();
  const start = now - rangeCfg.ms;
  const dates = new Set();
  for (let t = start; t <= now; t += 24 * 60 * 60 * 1000) {
    dates.add(new Date(t).toISOString().slice(0, 10));
  }
  dates.add(new Date(now).toISOString().slice(0, 10));
  return dates;
}

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function aggregateMetrics(hashObj, dates, filters = {}) {
  const out = {
    total: 0,
    byTenant: {},
    byProvider: {},
  };
  const tenantFilter = filters.tenantId ? String(filters.tenantId) : null;
  const providerFilter = filters.provider ? String(filters.provider).toLowerCase().trim() : null;
  for (const [field, rawValue] of Object.entries(hashObj || {})) {
    const value = toNumber(rawValue);
    if (!value) continue;

    // Campos padrão:
    // total:YYYY-MM-DD
    // tenant:<tenantId>:YYYY-MM-DD
    // provider:<provider>:YYYY-MM-DD
    const parts = field.split(':');
    if (parts.length < 2) continue;
    const kind = parts[0];
    const date = parts[parts.length - 1];
    if (!dates.has(date)) continue;

    if (kind === 'total') {
      // total só entra quando não há filtro (senão inflaria números sem recorte).
      if (!tenantFilter && !providerFilter) out.total += value;
      continue;
    }
    if (kind === 'tenant' && parts.length >= 3) {
      const tenantId = parts.slice(1, -1).join(':');
      if (tenantFilter && tenantFilter !== tenantId) continue;
      out.byTenant[tenantId] = (out.byTenant[tenantId] || 0) + value;
      out.total += value;
      continue;
    }
    if (kind === 'provider' && parts.length >= 3) {
      const provider = parts.slice(1, -1).join(':').toLowerCase();
      if (providerFilter && providerFilter !== provider) continue;
      out.byProvider[provider] = (out.byProvider[provider] || 0) + value;
      // Não soma em total aqui para evitar dupla contagem com byTenant.
    }
  }
  return out;
}

function severityFromRate(errorRatePercent) {
  if (errorRatePercent > 5) return 'critical';
  if (errorRatePercent >= 2) return 'warning';
  return null;
}

function messageFromSeverity(type, errorRatePercent, provider) {
  const scope = provider ? ` provider ${String(provider).toUpperCase()}` : ' sistema';
  if (type === 'critical') return `Taxa de erro crítica (${errorRatePercent.toFixed(2)}%) no${scope}.`;
  if (type === 'warning') return `Taxa de erro em atenção (${errorRatePercent.toFixed(2)}%) no${scope}.`;
  return 'Sistema normalizado';
}

function buildScopeKey({ tenantId, provider }) {
  return `tenant:${tenantId || 'all'}:provider:${provider || 'all'}`;
}

async function saveAlert(redis, alert) {
  if (!redis || !alert) return;
  await redis.hset('socket:alerts:store', alert.id, JSON.stringify(alert));
  await redis.lpush('socket:alerts:index', alert.id);
  await redis.ltrim('socket:alerts:index', 0, 299);
  await redis.expire('socket:alerts:index', 60 * 60 * 24 * 30);
  await redis.expire('socket:alerts:store', 60 * 60 * 24 * 30);
}

async function readAlertById(redis, id) {
  if (!redis || !id) return null;
  const raw = await redis.hget('socket:alerts:store', id);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function resolveActiveAlert(redis, scopeKey) {
  const activeId = await redis.hget('socket:alerts:active', scopeKey);
  if (!activeId) return null;
  const existing = await readAlertById(redis, activeId);
  if (!existing || existing.status === 'resolved') {
    await redis.hdel('socket:alerts:active', scopeKey);
    return null;
  }
  existing.status = 'resolved';
  existing.resolvedAt = new Date().toISOString();
  await saveAlert(redis, existing);
  await redis.hdel('socket:alerts:active', scopeKey);
  return existing;
}

async function upsertAlertByRate(redis, { errorRatePercent, tenantId, provider }) {
  const scopeKey = buildScopeKey({ tenantId, provider });
  const severity = severityFromRate(errorRatePercent);
  const activeId = await redis.hget('socket:alerts:active', scopeKey);
  const active = activeId ? await readAlertById(redis, activeId) : null;
  const now = new Date().toISOString();

  // Recuperação automática quando volta ao normal (<2%).
  if (!severity) {
    const resolved = await resolveActiveAlert(redis, scopeKey);
    if (!resolved) return { active: null, created: null, recovered: null };
    const recovery = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'info',
      message: 'Sistema normalizado',
      provider: provider || undefined,
      tenantId: tenantId || undefined,
      timestamp: now,
      status: 'resolved',
      resolvedAt: now,
      scopeKey,
    };
    await saveAlert(redis, recovery);
    return { active: null, created: null, recovered: recovery };
  }

  // Se já existe alerta ativo no mesmo nível, não duplica.
  if (active && active.status === 'active' && active.type === severity) {
    return { active, created: null, recovered: null };
  }

  // Resolve alerta anterior (se existir) antes de abrir novo incidente.
  if (active && active.status === 'active') {
    await resolveActiveAlert(redis, scopeKey);
  }

  const created = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: severity,
    message: messageFromSeverity(severity, errorRatePercent, provider),
    provider: provider || undefined,
    tenantId: tenantId || undefined,
    timestamp: now,
    status: 'active',
    resolvedAt: null,
    scopeKey,
  };
  await saveAlert(redis, created);
  await redis.hset('socket:alerts:active', scopeKey, created.id);
  await redis.expire('socket:alerts:active', 60 * 60 * 24 * 30);
  return { active: created, created, recovered: null };
}

async function readRecentAlerts(redis, filters = {}) {
  if (!redis) return [];
  try {
    const ids = await redis.lrange('socket:alerts:index', 0, 49);
    const tenantFilter = filters.tenantId ? String(filters.tenantId) : null;
    const providerFilter = filters.provider ? String(filters.provider).toLowerCase().trim() : null;
    const out = [];
    for (const id of ids) {
      const alert = await readAlertById(redis, id);
      if (!alert) continue;
      if (tenantFilter && String(alert.tenantId || '') !== tenantFilter) continue;
      if (providerFilter && String(alert.provider || '').toLowerCase() !== providerFilter) continue;
      out.push(alert);
      if (out.length >= 30) break;
    }
    return out;
  } catch {
    return [];
  }
}

async function dispatchExternalAlert(alert) {
  // Estrutura pronta para futuro envio externo (email/webhook/incident manager).
  if (!alert) return;
  const webhook = (process.env.ALERT_WEBHOOK_URL || '').trim();
  console.warn('[ALERT][CHANNEL_METRICS]', alert);
  if (!webhook) return;
  // Placeholder sem side-effects externos no momento.
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
      admin: { id: admin.id, email: admin.email, name: admin.name, role: 'SUPER_ADMIN' },
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
 * GET /api/global-admin/socket-metrics
 * Query:
 *  - tenantId (opcional)
 *  - provider (opcional)
 *  - range: 1h | 24h | 7d
 */
router.get('/socket-metrics', globalAdminAuth, async (req, res) => {
  try {
    const redis = globalThis.redisMain || null;
    if (!redis) {
      return res.status(503).json({ error: 'Redis indisponível para métricas de socket.' });
    }

    const tenantId = req.query?.tenantId ? String(req.query.tenantId).trim() : null;
    const provider = req.query?.provider ? String(req.query.provider).toLowerCase().trim() : null;
    const rangeCfg = parseRange(req.query?.range);
    const dates = collectDatesForRange(rangeCfg);

    const [eventsRaw, errorsRaw] = await Promise.all([
      redis.hgetall('socket:metrics:events'),
      redis.hgetall('socket:metrics:errors'),
    ]);

    const events = aggregateMetrics(eventsRaw, dates, { tenantId, provider });
    const errors = aggregateMetrics(errorsRaw, dates, { tenantId, provider });

    // Se total ficou 0 por ausência de campos tenant/provider, usa fallback com total:<date>.
    if (events.total === 0 && !tenantId && !provider) {
      for (const d of dates) {
        events.total += toNumber(eventsRaw?.[`total:${d}`]);
      }
    }
    if (errors.total === 0 && !tenantId && !provider) {
      for (const d of dates) {
        errors.total += toNumber(errorsRaw?.[`total:${d}`]);
      }
    }

    const totalEvents = events.total;
    const totalErrors = errors.total;
    const errorRate = totalEvents > 0 ? (totalErrors / totalEvents) * 100 : 0;
    const eventsPerMinute = totalEvents / rangeCfg.minutes;
    const lifecycleChanges = [];
    const globalLifecycle = await upsertAlertByRate(redis, {
      errorRatePercent: errorRate,
      tenantId,
      provider: provider || null,
    });
    if (globalLifecycle.created) lifecycleChanges.push(globalLifecycle.created);
    if (globalLifecycle.recovered) lifecycleChanges.push(globalLifecycle.recovered);

    // Alertas individuais por provider (quando não filtrado por provider).
    if (!provider) {
      const providerSet = new Set([
        ...Object.keys(events.byProvider || {}),
        ...Object.keys(errors.byProvider || {}),
      ]);
      for (const p of providerSet) {
        const ev = toNumber(events.byProvider?.[p]);
        const er = toNumber(errors.byProvider?.[p]);
        const rate = ev > 0 ? (er / ev) * 100 : 0;
        const life = await upsertAlertByRate(redis, {
          errorRatePercent: rate,
          tenantId,
          provider: p,
        });
        if (life.created) lifecycleChanges.push(life.created);
        if (life.recovered) lifecycleChanges.push(life.recovered);
      }
    }

    for (const changed of lifecycleChanges) {
      await dispatchExternalAlert(changed);
    }
    const recentAlerts = await readRecentAlerts(redis, { tenantId, provider });
    const activeAlerts = recentAlerts.filter((a) => a.status === 'active');

    return res.status(200).json({
      range: rangeCfg.label,
      filters: {
        tenantId,
        provider,
      },
      totals: {
        events: totalEvents,
        errors: totalErrors,
        errorRatePercent: Number(errorRate.toFixed(2)),
        eventsPerMinuteAvg: Number(eventsPerMinute.toFixed(4)),
      },
      breakdown: {
        tenants: events.byTenant,
        providers: events.byProvider,
        errorsByTenant: errors.byTenant,
        errorsByProvider: errors.byProvider,
      },
      alerts: {
        active: activeAlerts,
        recent: recentAlerts,
      },
      computedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[global-admin] socket-metrics:', err.message);
    return res.status(500).json({ error: 'Erro ao obter métricas de socket.' });
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

/**
 * GET /api/global-admin/tenant-users
 * Lista usuários de clientes (admins com tenant_id) com nome do tenant.
 */
router.get('/tenant-users', globalAdminAuth, async (req, res) => {
  try {
    const rows = await adminsRepo.findAllWithTenant();
    res.status(200).json(rows.map((r) => ({
      id: r.id,
      tenant_id: r.tenant_id,
      email: r.email,
      name: r.name ?? r.email,
      created_at: r.created_at,
      active: r.active !== false,
      tenant_name: r.tenant_name ?? r.tenant_slug ?? r.tenant_id,
    })));
  } catch (err) {
    console.error('[global-admin] tenant-users:', err.message);
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
      SELECT id, created_at
      FROM global_admin_logs
      ORDER BY created_at DESC
      LIMIT 100
    `);
    return res.status(200).json(rows.map((r) => ({ id: r.id, action: 'LOG', created_at: r.created_at })));
  } catch (err) {
    return res.status(200).json([]);
  }
});
export default router;
