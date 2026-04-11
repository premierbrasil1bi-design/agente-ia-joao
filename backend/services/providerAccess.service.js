import { getTenantById } from '../repositories/tenant.repository.js';
import { log } from '../utils/logger.js';
import { normalizeProviderId } from '../config/providersByPlan.js';
import {
  getEffectiveProvidersForTenant,
  isProviderEffectiveForTenant,
} from './providerPlanAccess.service.js';

export class ProviderAccessError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ProviderAccessError';
    this.code = code;
    this.httpStatus = 403;
    this.details = details;
    this.reason = code === 'PROVIDER_NOT_ALLOWED' ? 'provider_blocked' : null;
  }
}

export async function getTenantForProviderAccess(tenantId) {
  return getTenantById(tenantId);
}

/**
 * Validação central: provider deve estar na lista efetiva (plano ∩ tenant).
 * @param {{ tenantId: string, provider: string, channelId?: string | null, action?: string, requestId?: string | null }} ctx
 */
export async function assertProviderAllowedForTenant(ctx) {
  const tenantId = ctx?.tenantId;
  const raw = ctx?.provider;
  const p = normalizeProviderId(raw);
  if (!tenantId || !p) {
    throw new ProviderAccessError('PROVIDER_NOT_ALLOWED', 'Provider não disponível no plano atual', {
      tenantId: tenantId || null,
      provider: String(raw || ''),
      channelId: ctx?.channelId ?? null,
      action: ctx?.action ?? null,
      requestId: ctx?.requestId ?? null,
    });
  }
  await validateProviderAccessForTenant(tenantId, p);
}

export async function validateProviderAccessForTenant(tenantOrTenantId, provider) {
  const tenant =
    typeof tenantOrTenantId === 'string'
      ? await getTenantForProviderAccess(tenantOrTenantId)
      : tenantOrTenantId;
  const providerName = String(provider || '').toLowerCase().trim();
  if (!tenant) {
    throw new ProviderAccessError('TENANT_NOT_FOUND', 'Tenant não encontrado.');
  }
  if (!isProviderEffectiveForTenant(tenant, providerName)) {
    const effective = getEffectiveProvidersForTenant(tenant);
    log.warn({
      event: 'PROVIDER_BLOCKED_BY_PLAN',
      context: 'service',
      tenantId: tenant.id,
      metadata: { provider: providerName, effectiveProviders: effective },
    });
    throw new ProviderAccessError(
      'PROVIDER_NOT_ALLOWED',
      'Provider não disponível no plano atual',
      {
        tenantId: tenant.id,
        provider: providerName,
        allowedProviders: effective,
      }
    );
  }
  return true;
}

export async function filterProvidersByTenantAccess(tenantOrTenantId, providers) {
  const tenant =
    typeof tenantOrTenantId === 'string'
      ? await getTenantForProviderAccess(tenantOrTenantId)
      : tenantOrTenantId;
  if (!tenant) return [];
  const effective = new Set(getEffectiveProvidersForTenant(tenant));
  return (Array.isArray(providers) ? providers : [])
    .map((p) => String(p || '').toLowerCase().trim())
    .filter((p) => (p === 'whatsapp_oficial' ? effective.has('official') : effective.has(p)));
}

