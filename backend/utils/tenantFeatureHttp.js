/**
 * Resposta HTTP padronizada para feature bloqueada por plano.
 * @param {import('express').Response} res
 * @param {import('../services/tenantFeatures.service.js').TenantFeatureBlockedError} err
 */
export function sendTenantFeatureForbidden(res, err) {
  const status = err.httpStatus || 403;
  return res.status(status).json({
    error: err.message || 'Recurso não disponível no plano atual',
    reason: err.reason || 'feature_blocked',
    code: err.code || 'TENANT_FEATURE_BLOCKED',
    feature: err.feature || null,
  });
}
