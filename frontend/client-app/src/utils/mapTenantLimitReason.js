const BY_KEY = {
  channel_limit_reached: 'Seu plano atingiu o limite de canais.',
  agent_limit_reached: 'Seu plano atingiu o limite de agentes.',
  message_limit_reached: 'Seu plano atingiu o limite de mensagens.',
  realtime_monitoring_not_available: 'Seu plano não inclui monitoramento em tempo real.',
  connection_jobs_limit_reached: 'Seu plano atingiu o limite operacional de conexões.',
  provider_blocked: 'Este provider não está disponível no seu plano atual.',
  connected_channel_provider_change_blocked:
    'Desconecte o canal antes de trocar de provider, ou entre em contato com o suporte.',
  feature_blocked_generic: 'Este recurso não está incluído no seu plano atual.',
  feature_realtimeMonitoring: 'Monitoramento em tempo real está disponível em planos superiores.',
  feature_autoHealing: 'Reconexão automática de canais (auto-healing) está disponível em planos superiores.',
  feature_providerFallback:
    'Troca automática entre providers (fallback) na provisionamento está disponível em planos superiores.',
  feature_advancedArtifacts:
    'Artefatos avançados de conexão (endpoint dedicado) estão disponíveis no plano Enterprise.',
  feature_extendedMonitoringHistory: 'Histórico de monitoramento estendido (>30 pontos) está no plano Enterprise.',
};

export function mapTenantLimitReason(reason) {
  if (reason == null || String(reason).trim() === '') {
    return 'Esta ação não está disponível no seu plano atual.';
  }
  const raw = String(reason).trim();
  if (BY_KEY[raw]) return BY_KEY[raw];

  const lower = raw.toLowerCase();
  if (lower.includes('canais') && (lower.includes('limite') || lower.includes('atingido'))) {
    return BY_KEY.channel_limit_reached;
  }
  if (lower.includes('agentes') && (lower.includes('limite') || lower.includes('atingido'))) {
    return BY_KEY.agent_limit_reached;
  }
  if (lower.includes('mensagens') && (lower.includes('cota') || lower.includes('limite') || lower.includes('atingido'))) {
    return BY_KEY.message_limit_reached;
  }
  if (lower.includes('jobs') || (lower.includes('conexão') && lower.includes('limite'))) {
    return BY_KEY.connection_jobs_limit_reached;
  }
  if (lower.includes('monitoramento') || lower.includes('tempo real') || lower.includes('realtime')) {
    return BY_KEY.realtime_monitoring_not_available;
  }

  return raw;
}

/**
 * @param {Error & { code?: string, body?: object, reason?: string }} [err]
 */
export function isTenantPlanLimitError(err) {
  if (!err) return false;
  const c = String(err.code || err?.body?.code || err?.body?.error || '').trim();
  return (
    c === 'TENANT_PLAN_LIMIT' ||
    c === 'PROVIDER_NOT_ALLOWED' ||
    c === 'CHANNEL_PROVIDER_CHANGE_BLOCKED' ||
    c === 'TENANT_FEATURE_BLOCKED'
  );
}

/**
 * Razão canônica para o modal de upgrade (inclui provider bloqueado por plano).
 * @param {Error & { code?: string, body?: object, reason?: string }} [err]
 */
export function tenantPlanLimitReasonFromError(err) {
  const code = String(err?.code || err?.body?.code || err?.body?.error || '').trim();
  if (code === 'PROVIDER_NOT_ALLOWED') return 'provider_blocked';
  if (code === 'CHANNEL_PROVIDER_CHANGE_BLOCKED') return 'connected_channel_provider_change_blocked';
  if (code === 'TENANT_FEATURE_BLOCKED') {
    const f = err?.feature ?? err?.body?.feature;
    return f ? `feature_${f}` : 'feature_blocked_generic';
  }
  const r = err?.reason ?? err?.body?.reason;
  return r;
}
