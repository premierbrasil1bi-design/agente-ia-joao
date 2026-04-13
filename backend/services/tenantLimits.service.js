import { pool } from '../db/pool.js';
import { getPlanDefaults, normalizePlanKey } from '../config/plans.config.js';
import {
  getTenantById,
  refreshTenantAfterBillingCycleCheck,
} from '../repositories/tenant.repository.js';
import { getChannelConnectionQueue } from '../queues/channelConnection.queue.js';
import { log } from '../utils/logger.js';
import * as tenantLimitsCache from './tenantLimitsCache.js';
import { getEffectiveProvidersForTenant } from './providerPlanAccess.service.js';
import { computeFeaturesForTenantRow, invalidateTenantFeaturesCache } from './tenantFeatures.service.js';
import { getBaseFeaturesForPlan } from '../config/planFeatures.config.js';

function cacheKey(tenantId) {
  return String(tenantId || '').trim();
}

function pickSummary(limits, usage) {
  return {
    maxChannels: limits?.maxChannels ?? null,
    maxAgents: limits?.maxAgents ?? null,
    maxMessages: limits?.maxMessages ?? null,
    maxConcurrentConnectionJobs: limits?.maxConcurrentConnectionJobs ?? null,
    channels: usage?.channels ?? null,
    agents: usage?.agents ?? null,
    messages: usage?.messages ?? null,
    connectionJobs: usage?.connectionJobs ?? null,
  };
}

async function countChannels(tenantId) {
  const { rows } = await pool.query(
    'SELECT COUNT(*)::int AS c FROM channels WHERE tenant_id = $1',
    [tenantId],
  );
  return rows[0]?.c ?? 0;
}

async function countAgents(tenantId) {
  const { rows } = await pool.query(
    'SELECT COUNT(*)::int AS c FROM agents WHERE tenant_id = $1',
    [tenantId],
  );
  return rows[0]?.c ?? 0;
}

async function countTenantConnectionJobs(tenantId) {
  try {
    const q = getChannelConnectionQueue();
    let waiting = 0;
    let active = 0;
    const states = [
      ['waiting', 'waiting'],
      ['delayed', 'waiting'],
      ['active', 'active'],
    ];
    for (const [state, bucket] of states) {
      const jobs = await q.getJobs([state], 0, 400);
      for (const j of jobs) {
        if (String(j?.data?.tenantId || '') !== String(tenantId)) continue;
        if (bucket === 'active') active += 1;
        else waiting += 1;
      }
    }
    return { waiting, active, total: waiting + active };
  } catch (err) {
    log.warn({
      event: 'TENANT_LIMIT_QUEUE_COUNT_FAILED',
      context: 'service',
      tenantId,
      metadata: { reason: err?.message || String(err) },
    });
    return { waiting: 0, active: 0, total: 0 };
  }
}

function resolveNumericLimit(dbValue, planValue) {
  const db = dbValue != null && dbValue !== '' ? Number(dbValue) : null;
  if (db != null && Number.isFinite(db) && db > 0) return db;
  const p = planValue != null && planValue !== '' ? Number(planValue) : null;
  if (p != null && Number.isFinite(p) && p > 0) return p;
  return null;
}

function emptyCtx() {
  return {
    tenant: null,
    plan: 'free',
    limits: {
      maxChannels: null,
      maxAgents: null,
      maxMessages: null,
      maxConcurrentConnectionJobs: null,
      realtimeMonitoring: false,
    },
    usage: { channels: 0, agents: 0, messages: 0, connectionJobs: { waiting: 0, active: 0, total: 0 } },
  };
}

/**
 * @param {string} tenantId
 * @param {{ requestId?: string|null, skipCache?: boolean }} [opts]
 */
export async function loadTenantLimitsContext(tenantId, opts = {}) {
  const t = cacheKey(tenantId);
  if (!t) {
    const e = emptyCtx();
    return { tenant: null, plan: e.plan, limits: { ...e.limits, plan: e.plan }, usage: e.usage };
  }

  if (!opts.skipCache) {
    const cached = tenantLimitsCache.getTenantLimitsCached(t);
    if (cached) {
      log.info({
        event: 'TENANT_LIMIT_CACHE_HIT',
        context: 'service',
        tenantId: t,
      });
      return cached;
    }
  }

  log.info({
    event: 'TENANT_LIMIT_CACHE_MISS',
    context: 'service',
    tenantId: t,
  });

  await refreshTenantAfterBillingCycleCheck(t, 30).catch(() => {});
  const tenant = await getTenantById(t);
  const planKey = normalizePlanKey(tenant?.plan);
  const plan = getPlanDefaults(planKey);

  const maxAgents = resolveNumericLimit(tenant?.max_agents, plan.maxAgents);
  const maxMessages = resolveNumericLimit(tenant?.max_messages, plan.maxMessages);
  const maxChannels = plan.maxChannels != null && plan.maxChannels !== '' ? Number(plan.maxChannels) : null;
  const maxConcurrentConnectionJobs =
    plan.maxConcurrentConnectionJobs != null && plan.maxConcurrentConnectionJobs !== ''
      ? Number(plan.maxConcurrentConnectionJobs)
      : null;

  const [channels, agents, jobs] = await Promise.all([
    countChannels(t),
    countAgents(t),
    countTenantConnectionJobs(t),
  ]);

  const usedMessages = Math.max(0, Number(tenant?.messages_used_current_period ?? 0));

  const limits = {
    plan: planKey,
    maxChannels: maxChannels != null && Number.isFinite(maxChannels) && maxChannels > 0 ? maxChannels : null,
    maxAgents,
    maxMessages,
    maxConcurrentConnectionJobs:
      maxConcurrentConnectionJobs != null &&
      Number.isFinite(maxConcurrentConnectionJobs) &&
      maxConcurrentConnectionJobs > 0
        ? maxConcurrentConnectionJobs
        : null,
    realtimeMonitoring: Boolean(plan.realtimeMonitoring),
  };

  const usage = {
    channels,
    agents,
    messages: usedMessages,
    connectionJobs: jobs,
  };

  const payload = { tenant, plan: planKey, limits, usage };
  tenantLimitsCache.setTenantLimitsCache(t, payload);
  return payload;
}

function buildPublicFeatures(ctx) {
  const maxCh = ctx.limits.maxChannels;
  const maxAg = ctx.limits.maxAgents;
  const can_create_channels =
    maxCh == null || maxCh <= 0 ? true : ctx.usage.channels < maxCh;
  const can_create_agents = maxAg == null || maxAg <= 0 ? true : ctx.usage.agents < maxAg;
  const allowed_providers = ctx.tenant ? getEffectiveProvidersForTenant(ctx.tenant) : [];
  const flags = ctx.tenant ? computeFeaturesForTenantRow(ctx.tenant) : getBaseFeaturesForPlan('free');
  return {
    ...flags,
    allowed_providers,
    can_create_agents,
    can_create_channels,
  };
}

function baseResult(ctx, allowed, reason, opts = {}) {
  const { requestId } = opts;
  return {
    allowed,
    reason: reason ?? null,
    limits: {
      plan: ctx.plan,
      maxChannels: ctx.limits.maxChannels,
      maxAgents: ctx.limits.maxAgents,
      maxMessages: ctx.limits.maxMessages,
    },
    usage: {
      channels: ctx.usage.channels,
      agents: ctx.usage.agents,
      messages: ctx.usage.messages,
      connectionJobsTotal: ctx.usage.connectionJobs?.total ?? 0,
      connectionJobsWaiting: ctx.usage.connectionJobs?.waiting ?? 0,
      connectionJobsActive: ctx.usage.connectionJobs?.active ?? 0,
    },
    _meta: { requestId: requestId ?? null },
  };
}

function logLimitDenied(checkName, ctx, reason, opts) {
  log.warn({
    event: 'TENANT_LIMIT_EXCEEDED',
    context: 'service',
    tenantId: ctx.tenant?.id ?? opts?.tenantId ?? null,
    plan: ctx.plan,
    reason,
    metadata: {
      check: checkName,
      requestId: opts?.requestId ?? null,
      ...pickSummary(ctx.limits, ctx.usage),
    },
  });
  log.info({
    event: 'TENANT_LIMIT_CHECK',
    context: 'service',
    tenantId: ctx.tenant?.id ?? opts?.tenantId ?? null,
    plan: ctx.plan,
    metadata: {
      check: checkName,
      allowed: false,
      reason,
      requestId: opts?.requestId ?? null,
      ...pickSummary(ctx.limits, ctx.usage),
    },
  });
}

function logLimitOk(checkName, ctx, opts) {
  if (!opts?.logSuccessCheck) return;
  log.info({
    event: 'TENANT_LIMIT_CHECK',
    context: 'service',
    tenantId: ctx.tenant?.id ?? null,
    plan: ctx.plan,
    metadata: {
      check: checkName,
      allowed: true,
      reason: null,
      requestId: opts?.requestId ?? null,
      ...pickSummary(ctx.limits, ctx.usage),
    },
  });
}

export async function getTenantLimits(tenantId, opts = {}) {
  const ctx = await loadTenantLimitsContext(tenantId, opts);
  if (!ctx.tenant) {
    return baseResult(emptyCtx(), false, 'Tenant não encontrado', opts);
  }
  if (ctx.tenant.active !== true) {
    return baseResult(ctx, false, 'Tenant inativo ou suspenso', opts);
  }
  const maxMsg = ctx.limits.maxMessages;
  const msgExceeded = maxMsg != null && ctx.usage.messages >= maxMsg;
  const chExceeded =
    ctx.limits.maxChannels != null && ctx.usage.channels > ctx.limits.maxChannels;
  const allowed = !msgExceeded && !chExceeded;
  const reason = msgExceeded
    ? 'Cota de mensagens do período esgotada'
    : chExceeded
      ? 'Quantidade de canais acima do permitido pelo plano'
      : null;
  return baseResult(ctx, allowed, reason, opts);
}

/** Payload estável para GET /api/tenant/limits e /api/agent/tenant/limits */
export async function getTenantLimitsPublicPayload(tenantId, opts = {}) {
  const ctx = await loadTenantLimitsContext(tenantId, opts);
  return {
    plan: ctx.plan,
    limits: {
      maxChannels: ctx.limits.maxChannels,
      maxAgents: ctx.limits.maxAgents,
      maxMessages: ctx.limits.maxMessages,
      maxConcurrentConnectionJobs: ctx.limits.maxConcurrentConnectionJobs,
    },
    usage: {
      channels: ctx.usage.channels,
      agents: ctx.usage.agents,
      messages: ctx.usage.messages,
      connectionJobs: ctx.usage.connectionJobs,
    },
    features: buildPublicFeatures(ctx),
  };
}

export async function canCreateChannel(tenantId, opts = {}) {
  const ctx = await loadTenantLimitsContext(tenantId, opts);
  if (!ctx.tenant) {
    logLimitDenied('canCreateChannel', emptyCtx(), 'Tenant não encontrado', { ...opts, tenantId });
    return baseResult(emptyCtx(), false, 'Tenant não encontrado', opts);
  }
  if (ctx.tenant.active !== true) {
    logLimitDenied('canCreateChannel', ctx, 'Tenant inativo ou suspenso', opts);
    return baseResult(ctx, false, 'Tenant inativo ou suspenso', opts);
  }
  const max = ctx.limits.maxChannels;
  if (max == null || max <= 0) {
    logLimitOk('canCreateChannel', ctx, opts);
    return baseResult(ctx, true, null, opts);
  }
  if (ctx.usage.channels >= max) {
    logLimitDenied('canCreateChannel', ctx, 'Limite de canais do plano atingido', opts);
    return baseResult(ctx, false, 'Limite de canais do plano atingido', opts);
  }
  logLimitOk('canCreateChannel', ctx, opts);
  return baseResult(ctx, true, null, opts);
}

export async function canConnectChannel(tenantId, opts = {}) {
  const ctx = await loadTenantLimitsContext(tenantId, opts);
  if (!ctx.tenant) {
    logLimitDenied('canConnectChannel', emptyCtx(), 'Tenant não encontrado', { ...opts, tenantId });
    return baseResult(emptyCtx(), false, 'Tenant não encontrado', opts);
  }
  if (ctx.tenant.active !== true) {
    logLimitDenied('canConnectChannel', ctx, 'Tenant inativo ou suspenso', opts);
    return baseResult(ctx, false, 'Tenant inativo ou suspenso', opts);
  }
  const maxMsg = ctx.limits.maxMessages;
  if (maxMsg != null && ctx.usage.messages >= maxMsg) {
    logLimitDenied('canConnectChannel', ctx, 'Cota de mensagens do período esgotada', opts);
    return baseResult(ctx, false, 'Cota de mensagens do período esgotada', opts);
  }
  return baseResult(ctx, true, null, opts);
}

export async function canEnqueueConnectionJob(tenantId, opts = {}) {
  const connect = await canConnectChannel(tenantId, opts);
  if (!connect.allowed) return connect;

  const ctx = await loadTenantLimitsContext(tenantId, { ...opts, skipCache: true });
  const maxJ = ctx.limits.maxConcurrentConnectionJobs;
  if (maxJ == null || maxJ <= 0) {
    return baseResult(ctx, true, null, opts);
  }
  if (ctx.usage.connectionJobs.total >= maxJ) {
    logLimitDenied('canEnqueueConnectionJob', ctx, 'Limite de jobs de conexão do plano atingido', opts);
    return baseResult(ctx, false, 'Limite de jobs de conexão do plano atingido', opts);
  }
  return baseResult(ctx, true, null, opts);
}

export async function canUseRealtimeMonitoring(tenantId, opts = {}) {
  const ctx = await loadTenantLimitsContext(tenantId, opts);
  const allowed = Boolean(ctx.tenant?.active) && Boolean(ctx.limits.realtimeMonitoring);
  if (!allowed && !opts.skipFeatureBlockedLog) {
    log.warn({
      event: 'TENANT_FEATURE_BLOCKED',
      context: 'service',
      tenantId: (ctx.tenant?.id ?? String(tenantId || '').trim()) || null,
      plan: ctx.plan,
      reason: 'realtime_monitoring_not_included',
      metadata: {
        requestId: opts?.requestId ?? null,
        ...pickSummary(ctx.limits, ctx.usage),
      },
    });
  }
  return {
    allowed,
    reason: allowed ? null : 'Monitoramento em tempo real não incluído no plano',
    limits: {
      plan: ctx.plan,
      maxChannels: ctx.limits.maxChannels,
      maxAgents: ctx.limits.maxAgents,
      maxMessages: ctx.limits.maxMessages,
    },
    usage: baseResult(ctx, allowed, null, opts).usage,
    _meta: { requestId: opts.requestId ?? null },
  };
}

export async function canCreateAgent(tenantId, opts = {}) {
  const ctx = await loadTenantLimitsContext(tenantId, opts);
  if (!ctx.tenant) {
    logLimitDenied('canCreateAgent', emptyCtx(), 'Tenant não encontrado', { ...opts, tenantId });
    return baseResult(emptyCtx(), false, 'Tenant não encontrado', opts);
  }
  if (ctx.tenant.active !== true) {
    logLimitDenied('canCreateAgent', ctx, 'Tenant inativo ou suspenso', opts);
    return baseResult(ctx, false, 'Tenant inativo ou suspenso', opts);
  }
  const max = ctx.limits.maxAgents;
  if (max == null || max <= 0) {
    logLimitOk('canCreateAgent', ctx, opts);
    return baseResult(ctx, true, null, opts);
  }
  if (ctx.usage.agents >= max) {
    logLimitDenied('canCreateAgent', ctx, 'Limite de agentes do plano atingido', opts);
    return baseResult(ctx, false, 'Limite de agentes do plano atingido', opts);
  }
  logLimitOk('canCreateAgent', ctx, opts);
  return baseResult(ctx, true, null, opts);
}

export function invalidateTenantLimitsCache(tenantId) {
  tenantLimitsCache.invalidateTenantLimitsCache(tenantId);
  invalidateTenantFeaturesCache(tenantId);
}
