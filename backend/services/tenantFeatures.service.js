/**
 * Feature flags efetivas por tenant: plano + overrides opcionais na linha do tenant.
 */

import { log } from '../utils/logger.js';
import { getTenantById } from '../repositories/tenant.repository.js';
import { normalizePlanKey } from '../config/plans.config.js';
import { getBaseFeaturesForPlan, PLAN_FEATURE_KEYS } from '../config/planFeatures.config.js';

/**
 * Aceita apenas chaves conhecidas em planFeatures; ignora demais. Somente valores booleanos.
 * @param {unknown} flags
 * @returns {Record<string, boolean>}
 */
export function validateTenantFeatureFlags(flags) {
  if (!flags || typeof flags !== 'object' || Array.isArray(flags)) return {};
  /** @type {Record<string, boolean>} */
  const out = {};
  for (const key of PLAN_FEATURE_KEYS) {
    if (typeof flags[key] === 'boolean') out[key] = flags[key];
  }
  return out;
}

const CACHE_TTL_MS = 10_000;
/** @type {Map<string, { at: number, plan: string, features: Record<string, boolean> }>} */
const cache = new Map();

export class TenantFeatureBlockedError extends Error {
  /**
   * @param {string} feature
   * @param {string} [message]
   */
  constructor(feature, message) {
    super(message || 'Recurso não disponível no plano atual');
    this.name = 'TenantFeatureBlockedError';
    this.code = 'TENANT_FEATURE_BLOCKED';
    this.reason = 'feature_blocked';
    this.feature = feature;
    this.httpStatus = 403;
  }
}

/**
 * Lê overrides por tenant sem migração obrigatória: `feature_flags` JSONB ou `settings.features`.
 * @param {object | null | undefined} tenant
 * @returns {Record<string, boolean>}
 */
function readTenantFeatureOverrides(tenant) {
  const raw =
    tenant?.feature_flags && typeof tenant.feature_flags === 'object' && !Array.isArray(tenant.feature_flags)
      ? tenant.feature_flags
      : tenant?.settings?.features && typeof tenant.settings.features === 'object'
        ? tenant.settings.features
        : null;
  return validateTenantFeatureFlags(raw);
}

/**
 * @param {object | null | undefined} tenant
 * @returns {Record<string, boolean>}
 */
export function computeFeaturesForTenantRow(tenant) {
  const planKey = normalizePlanKey(tenant?.plan);
  const base = getBaseFeaturesForPlan(planKey);
  const overrides = readTenantFeatureOverrides(tenant);
  return { ...base, ...overrides };
}

/**
 * @param {string} tenantId
 * @returns {Promise<{ plan: string, features: Record<string, boolean> }>}
 */
export async function getTenantFeaturePayload(tenantId) {
  const t = String(tenantId || '').trim();
  if (!t) {
    const features = getBaseFeaturesForPlan('free');
    return { plan: 'free', features };
  }

  const now = Date.now();
  const hit = cache.get(t);
  if (hit && now - hit.at < CACHE_TTL_MS) {
    return { plan: hit.plan, features: { ...hit.features } };
  }

  const tenant = await getTenantById(t);
  const plan = normalizePlanKey(tenant?.plan);
  const features = computeFeaturesForTenantRow(tenant);
  cache.set(t, { at: now, plan, features });
  return { plan, features };
}

/** @param {string} tenantId */
export async function getTenantFeatures(tenantId) {
  const { features } = await getTenantFeaturePayload(tenantId);
  return { ...features };
}

/**
 * @param {string} tenantId
 * @param {string} featureName
 */
export async function hasTenantFeature(tenantId, featureName) {
  const { features } = await getTenantFeaturePayload(tenantId);
  return Boolean(features[featureName]);
}

/**
 * @param {string} tenantId
 * @param {string} featureName
 * @param {{ channelId?: string|null, requestId?: string|null, logCheck?: boolean }} [context]
 */
export async function assertTenantFeature(tenantId, featureName, context = {}) {
  const { plan, features } = await getTenantFeaturePayload(tenantId);
  const allowed = Boolean(features[featureName]);

  if (context.logCheck !== false) {
    log.info({
      event: 'TENANT_FEATURE_CHECK',
      context: 'service',
      tenantId: String(tenantId || '').trim() || null,
      plan,
      feature: featureName,
      allowed,
      channelId: context.channelId ?? null,
      requestId: context.requestId ?? null,
    });
  }

  if (!allowed) {
    log.warn({
      event: 'TENANT_FEATURE_BLOCKED',
      context: 'service',
      tenantId: String(tenantId || '').trim() || null,
      plan,
      feature: featureName,
      channelId: context.channelId ?? null,
      requestId: context.requestId ?? null,
    });
    throw new TenantFeatureBlockedError(featureName);
  }

  log.info({
    event: 'TENANT_FEATURE_ALLOWED',
    context: 'service',
    tenantId: String(tenantId || '').trim() || null,
    plan,
    feature: featureName,
    channelId: context.channelId ?? null,
    requestId: context.requestId ?? null,
  });
}

export function invalidateTenantFeaturesCache(tenantId) {
  const t = String(tenantId || '').trim();
  if (t) cache.delete(t);
  else cache.clear();
}
