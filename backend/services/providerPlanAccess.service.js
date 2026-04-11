import { normalizePlanKey } from '../config/plans.config.js';
import { PROVIDERS_BY_PLAN, normalizeProviderId } from '../config/providersByPlan.js';
import { sanitizeAllowedProviders } from '../utils/tenantAllowedProviders.js';

/**
 * Lista base do plano (sem filtro do tenant).
 * @param {string | null | undefined} planRaw
 * @returns {string[]}
 */
export function getProvidersForPlan(planRaw) {
  const k = normalizePlanKey(planRaw);
  const list = PROVIDERS_BY_PLAN[k] || PROVIDERS_BY_PLAN.free;
  return list.map((p) => normalizeProviderId(p));
}

/**
 * Provedores efetivos: plano ∩ (allowed_providers do tenant, se existir).
 * @param {object | null | undefined} tenant — linha `tenants`
 * @returns {string[]}
 */
export function getEffectiveProvidersForTenant(tenant) {
  if (!tenant) return [];
  const planList = getProvidersForPlan(tenant.plan);
  const raw = tenant.allowed_providers;
  if (!Array.isArray(raw) || raw.length === 0) {
    return [...planList];
  }
  const tenantSan = sanitizeAllowedProviders(raw).map((p) => normalizeProviderId(p));
  const tenantSet = new Set(tenantSan);
  return planList.filter((p) => tenantSet.has(p));
}

/**
 * @param {object | null | undefined} tenant
 * @param {string | null | undefined} provider
 */
export function isProviderEffectiveForTenant(tenant, provider) {
  const p = normalizeProviderId(provider);
  if (!p) return false;
  return getEffectiveProvidersForTenant(tenant).includes(p);
}
