import express from 'express';
import authJWT from '../middleware/authJWT.js';
import { requireActiveTenant } from '../middleware/requireActiveTenant.js';
import { getTenantMessageUsageFromLogs } from '../repositories/tenantMessageUsageLog.repository.js';

const router = express.Router();

/**
 * GET /api/tenant/usage
 * Consumo de mensagens no ciclo atual (billing_cycle_start), contado só via tenant_message_usage_logs (success).
 */
router.get(
  '/usage',
  authJWT,
  requireActiveTenant,
  async (req, res) => {
    try {
      const tenantId = req.user.tenantId;

      const row = await getTenantMessageUsageFromLogs(tenantId);

      if (!row) {
        return res.status(404).json({ error: 'Tenant não encontrado' });
      }

      const max = row.max_messages != null ? Number(row.max_messages) : null;
      const used = Math.max(0, Number(row.messages_used_success ?? 0));
      const unlimited = max == null || !Number.isFinite(max) || max <= 0;
      const messages_remaining = unlimited ? null : Math.max(0, max - used);

      return res.json({
        billing_cycle_start: row.billing_cycle_start
          ? new Date(row.billing_cycle_start).toISOString()
          : null,
        max_messages: unlimited ? null : max,
        messages_used_success: used,
        messages_remaining,
        unlimited,
        plan: row.plan ?? null,
      });
    } catch (error) {
      console.error('Erro tenant usage:', error);
      return res.status(500).json({ error: 'Erro interno' });
    }
  }
);

export default router;
