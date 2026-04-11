import { ProviderAccessError } from '../services/providerAccess.service.js';

/**
 * Resposta HTTP para bloqueio de provider por plano/tenant (contrato estável para o frontend).
 * @param {import('express').Response} res
 * @param {ProviderAccessError} err
 */
export function sendProviderAccessForbidden(res, err) {
  if (!(err instanceof ProviderAccessError)) return false;
  const status = err.httpStatus || 403;
  if (err.code === 'PROVIDER_NOT_ALLOWED') {
    return res.status(status).json({
      error: err.message,
      reason: err.reason || 'provider_blocked',
      code: err.code,
    });
  }
  return res.status(status).json({
    error: err.message,
    code: err.code,
    ...(err.reason ? { reason: err.reason } : {}),
    ...(err.details && Object.keys(err.details).length > 0 ? { details: err.details } : {}),
  });
}

/**
 * @param {import('express').Response} res
 * @param {import('../services/channelProviderChangeGuard.service.js').ConnectedChannelProviderChangeError} err
 */
export function sendConnectedChannelProviderChangeBlocked(res, err) {
  const status = err.httpStatus || 409;
  return res.status(status).json({
    error: err.message,
    reason: err.reason,
    code: err.code,
  });
}
