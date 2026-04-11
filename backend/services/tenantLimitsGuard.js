import { log } from '../utils/logger.js';
import { canCreateAgent, canCreateChannel, loadTenantLimitsContext } from './tenantLimits.service.js';

export class TenantPlanLimitBlockedError extends Error {
  /** @param {{ allowed: boolean, reason?: string|null }} check */
  constructor(check) {
    super(check?.reason || 'Limite do plano atingido');
    this.name = 'TenantPlanLimitBlockedError';
    this.code = 'TENANT_PLAN_LIMIT';
    this.reason = check?.reason ?? null;
    this.check = check;
  }
}

/**
 * @param {string} tenantId
 * @param {{ requestId?: string|null, logSuccessCheck?: boolean }} [opts]
 */
export async function assertCanCreateChannel(tenantId, opts = {}) {
  const check = await canCreateChannel(tenantId, opts);
  if (!check.allowed) {
    log.warn({
      event: 'TENANT_LIMIT_BLOCKED',
      context: 'guard',
      tenantId,
      metadata: { check: 'canCreateChannel', reason: check.reason },
    });
    throw new TenantPlanLimitBlockedError(check);
  }
}

/**
 * @param {string} tenantId
 * @param {{ requestId?: string|null, logSuccessCheck?: boolean }} [opts]
 */
export async function assertCanCreateAgent(tenantId, opts = {}) {
  const check = await canCreateAgent(tenantId, opts);
  if (!check.allowed) {
    log.warn({
      event: 'TENANT_LIMIT_BLOCKED',
      context: 'guard',
      tenantId,
      metadata: { check: 'canCreateAgent', reason: check.reason },
    });
    throw new TenantPlanLimitBlockedError(check);
  }
}

/**
 * Pré-checagem de cota de mensagens (o consumo atômico continua em tryConsumeTenantMessageQuota).
 * @param {string} tenantId
 * @param {{ requestId?: string|null }} [opts]
 */
export async function assertCanSendMessage(tenantId, opts = {}) {
  const ctx = await loadTenantLimitsContext(tenantId, { ...opts, skipCache: true });
  if (!ctx.tenant) {
    const check = { allowed: false, reason: 'Tenant não encontrado' };
    log.warn({
      event: 'TENANT_LIMIT_BLOCKED',
      context: 'guard',
      tenantId,
      metadata: { check: 'sendMessage', reason: check.reason },
    });
    throw new TenantPlanLimitBlockedError(check);
  }
  if (ctx.tenant.active !== true) {
    const check = { allowed: false, reason: 'Tenant inativo ou suspenso' };
    log.warn({
      event: 'TENANT_LIMIT_BLOCKED',
      context: 'guard',
      tenantId,
      metadata: { check: 'sendMessage', reason: check.reason },
    });
    throw new TenantPlanLimitBlockedError(check);
  }
  const max = ctx.limits.maxMessages;
  if (max != null && max > 0 && ctx.usage.messages >= max) {
    const check = { allowed: false, reason: 'Cota de mensagens do período esgotada' };
    log.warn({
      event: 'TENANT_LIMIT_BLOCKED',
      context: 'guard',
      tenantId,
      metadata: { check: 'sendMessage', reason: check.reason },
    });
    throw new TenantPlanLimitBlockedError(check);
  }
}
