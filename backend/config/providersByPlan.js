/**
 * Providers de canal permitidos por plano (interseção com `tenants.allowed_providers` quando definido).
 * Chaves alinhadas a `normalizePlanKey` (free | pro | enterprise).
 */

export const PROVIDERS_BY_PLAN = {
  free: ['waha'],
  pro: ['waha', 'evolution'],
  enterprise: ['waha', 'evolution', 'zapi', 'official'],
};

/**
 * @param {string | null | undefined} provider
 * @returns {string}
 */
export function normalizeProviderId(provider) {
  const s = String(provider || '').toLowerCase().trim();
  if (s === 'whatsapp_oficial') return 'official';
  return s;
}
