/**
 * Defaults por plano. Valores no registro do tenant (max_agents, max_messages, etc.) prevalecem quando definidos.
 * maxChannels: só via plano (sem coluna no tenant neste schema).
 * null em limite numérico = ilimitado para enforcement.
 * realtimeMonitoring vem de planFeatures.config.js (getPlanDefaults faz o merge).
 */

import { getBaseFeaturesForPlan } from './planFeatures.config.js';

export const PLANS = {
  free: {
    maxChannels: 1,
    maxAgents: 2,
    maxMessages: 500,
    maxConcurrentConnectionJobs: 2,
  },
  pro: {
    maxChannels: 5,
    maxAgents: 10,
    maxMessages: null,
    maxConcurrentConnectionJobs: 10,
  },
  enterprise: {
    maxChannels: 9999,
    maxAgents: null,
    maxMessages: null,
    maxConcurrentConnectionJobs: 100,
  },
};

const DEFAULT_PLAN_KEY = 'free';

export function normalizePlanKey(raw) {
  const k = String(raw || '')
    .toLowerCase()
    .trim();
  if (!k) return DEFAULT_PLAN_KEY;
  if (PLANS[k]) return k;
  if (k.includes('enterprise')) return 'enterprise';
  if (k.includes('pro')) return 'pro';
  return DEFAULT_PLAN_KEY;
}

export function getPlanDefaults(planKey) {
  const key = normalizePlanKey(planKey);
  const feats = getBaseFeaturesForPlan(key);
  return {
    key,
    ...PLANS[key],
    realtimeMonitoring: Boolean(feats.realtimeMonitoring),
  };
}
