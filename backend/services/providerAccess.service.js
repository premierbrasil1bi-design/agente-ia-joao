import { getTenantById } from '../repositories/tenant.repository.js';
import {
  filterAllowedProvidersForTenant,
  getAllowedProviders,
  isProviderAllowedForTenant,
} from '../utils/tenantAllowedProviders.js';

export class ProviderAccessError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ProviderAccessError';
    this.code = code;
    this.httpStatus = 403;
    this.details = details;
  }
}

export async function getTenantForProviderAccess(tenantId) {
  return getTenantById(tenantId);
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
  if (!isProviderAllowedForTenant(tenant, providerName)) {
    console.warn('[PROVIDER ACCESS] denied', {
      tenantId: tenant.id,
      provider: providerName,
      allowedProviders: getAllowedProviders(tenant),
    });
    throw new ProviderAccessError(
      'PROVIDER_NOT_ALLOWED',
      'Provider não permitido para este tenant/plano',
      {
        tenantId: tenant.id,
        provider: providerName,
        allowedProviders: getAllowedProviders(tenant),
      }
    );
  }
  console.info('[PROVIDER ACCESS] allowed', { tenantId: tenant.id, provider: providerName });
  return true;
}

export async function filterProvidersByTenantAccess(tenantOrTenantId, providers) {
  const tenant =
    typeof tenantOrTenantId === 'string'
      ? await getTenantForProviderAccess(tenantOrTenantId)
      : tenantOrTenantId;
  if (!tenant) return [];
  return filterAllowedProvidersForTenant(tenant, providers);
}

