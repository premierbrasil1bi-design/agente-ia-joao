import { Router } from 'express';
import { getTenantLimitsPublicPayload } from '../services/tenantLimits.service.js';
import { log } from '../utils/logger.js';

const router = Router();

/**
 * GET /api/agent/tenant/limits
 * Mesmo contrato de GET /api/tenant/limits (Client App com agentAuth + requireTenant).
 */
router.get('/limits', async (req, res) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Tenant não identificado' });
    }
    const payload = await getTenantLimitsPublicPayload(tenantId, {
      requestId: req.requestId ?? req.correlationId ?? null,
    });
    return res.json(payload);
  } catch (err) {
    log.error({
      event: 'AGENT_TENANT_LIMITS_ERROR',
      context: 'route',
      tenantId: req.tenantId ?? null,
      error: err?.message || String(err),
      stack: err?.stack,
    });
    return res.status(500).json({ error: 'Erro interno' });
  }
});

export default router;
