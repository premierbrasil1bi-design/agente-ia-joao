const KNOWN_WHATSAPP_PROVIDERS = ['evolution', 'waha', 'zapi', 'official'];

export function sanitizeAllowedProviders(input) {
  if (!Array.isArray(input)) return [];
  const cleaned = input
    .map((p) => {
      const s = String(p || '').toLowerCase().trim();
      return s === 'whatsapp_oficial' ? 'official' : s;
    })
    .filter((p) => KNOWN_WHATSAPP_PROVIDERS.includes(p));
  return [...new Set(cleaned)];
}

export function getAllowedProviders(tenant) {
  const raw = tenant?.allowed_providers;
  if (!Array.isArray(raw) || raw.length === 0) {
    // compatibilidade histórica: ausência/vazio => todos permitidos
    return [...KNOWN_WHATSAPP_PROVIDERS];
  }
  const sanitized = sanitizeAllowedProviders(raw);
  return sanitized.length > 0 ? sanitized : [...KNOWN_WHATSAPP_PROVIDERS];
}

export function isProviderAllowedForTenant(tenant, provider) {
  const p = String(provider || '').toLowerCase().trim();
  return getAllowedProviders(tenant).includes(p);
}

export function filterAllowedProvidersForTenant(tenant, providers) {
  const allowed = new Set(getAllowedProviders(tenant));
  return (Array.isArray(providers) ? providers : [])
    .map((p) => String(p || '').toLowerCase().trim())
    .filter((p) => allowed.has(p));
}

export function listKnownWhatsappProviders() {
  return [...KNOWN_WHATSAPP_PROVIDERS];
}

