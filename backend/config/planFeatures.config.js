/**
 * Feature flags base por plano (fonte única para capacidades, além de quotas).
 * Overrides futuros por tenant: ver tenantFeatures.service (ex.: tenant.feature_flags JSON).
 */

export const PLAN_FEATURES = {
  free: {
    realtimeMonitoring: false,
    autoHealing: false,
    providerFallback: false,
    advancedArtifacts: false,
    extendedMonitoringHistory: false,
  },
  pro: {
    realtimeMonitoring: true,
    autoHealing: true,
    providerFallback: true,
    advancedArtifacts: false,
    extendedMonitoringHistory: false,
  },
  enterprise: {
    realtimeMonitoring: true,
    autoHealing: true,
    providerFallback: true,
    advancedArtifacts: true,
    extendedMonitoringHistory: true,
  },
};

/** @type {(keyof typeof PLAN_FEATURES.free)[]} */
export const PLAN_FEATURE_KEYS = [
  'realtimeMonitoring',
  'autoHealing',
  'providerFallback',
  'advancedArtifacts',
  'extendedMonitoringHistory',
];

/**
 * @param {string | null | undefined} planRaw
 * @returns {Record<string, boolean>}
 */
export function getBaseFeaturesForPlan(planRaw) {
  const k = String(planRaw || '')
    .toLowerCase()
    .trim();
  if (PLAN_FEATURES[k]) {
    return { ...PLAN_FEATURES[k] };
  }
  if (k.includes('enterprise')) return { ...PLAN_FEATURES.enterprise };
  if (k.includes('pro')) return { ...PLAN_FEATURES.pro };
  return { ...PLAN_FEATURES.free };
}
