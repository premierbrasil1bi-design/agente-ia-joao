/**
 * Presets de overrides de feature flags para aplicação rápida no admin global.
 * Valores são filtrados/validados em runtime com validateTenantFeatureFlags.
 */

const FEATURE_FLAG_TEMPLATES = {
  enterprise_safe: {
    realtimeMonitoring: true,
    autoHealing: true,
    providerFallback: true,
    advancedArtifacts: true,
    extendedMonitoringHistory: true,
  },
  pilot_restricted: {
    realtimeMonitoring: false,
    autoHealing: false,
    providerFallback: false,
    advancedArtifacts: false,
    extendedMonitoringHistory: false,
  },
};

export default FEATURE_FLAG_TEMPLATES;

/**
 * @param {unknown} rawKey
 * @returns {{ key: string, flags: Record<string, boolean> } | null}
 */
export function getFeatureTemplateByKey(rawKey) {
  const key = String(rawKey ?? '').trim();
  if (!key || !Object.prototype.hasOwnProperty.call(FEATURE_FLAG_TEMPLATES, key)) return null;
  return { key, flags: { ...FEATURE_FLAG_TEMPLATES[key] } };
}

/** @returns {{ key: string, flags: Record<string, boolean> }[]} */
export function listFeatureTemplatesForApi() {
  return Object.entries(FEATURE_FLAG_TEMPLATES).map(([key, flags]) => ({
    key,
    flags: { ...flags },
  }));
}
