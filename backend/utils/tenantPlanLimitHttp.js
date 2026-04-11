/**
 * Status e payload HTTP para bloqueios de plano/limites do tenant.
 */

export function httpStatusForPlanLimitReason(reason) {
  const r = String(reason || '');
  if (r.includes('mensagens')) return 429;
  if (r.includes('jobs')) return 429;
  return 403;
}

export function sendTenantPlanLimit(res, check) {
  const status = httpStatusForPlanLimitReason(check?.reason);
  return res.status(status).json({
    error: 'Limite do plano atingido',
    reason: check?.reason ?? null,
    code: 'TENANT_PLAN_LIMIT',
  });
}
