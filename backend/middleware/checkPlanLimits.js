import * as tenantLimits from '../services/tenantLimits.service.js';
import { sendTenantPlanLimit } from '../utils/tenantPlanLimitHttp.js';
import { log } from '../utils/logger.js';

export async function checkAgentLimit(req, res, next) {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Tenant não identificado' });
    }

    const check = await tenantLimits.canCreateAgent(tenantId, {
      requestId: req.requestId ?? null,
      logSuccessCheck: true,
    });

    if (!check.allowed) {
      log.warn({
        event: 'TENANT_LIMIT_BLOCKED',
        context: 'middleware',
        tenantId,
        metadata: { check: 'canCreateAgent', reason: check.reason },
      });
      return sendTenantPlanLimit(res, check);
    }

    next();
  } catch (error) {
    log.error({
      event: 'CHECK_AGENT_LIMIT_ERROR',
      context: 'middleware',
      tenantId: req.user?.tenantId ?? null,
      error: error?.message || String(error),
      stack: error?.stack,
    });
    return res.status(500).json({ error: 'Erro interno' });
  }
}
