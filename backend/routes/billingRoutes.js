import express from 'express';
import authJWT from '../middleware/authJWT.js';
import { requireActiveTenant } from '../middleware/requireActiveTenant.js';
import { log } from '../utils/logger.js';
import * as billingService from '../services/billing.service.js';

const router = express.Router();

/**
 * POST /api/billing/checkout
 * Body: { plan: "pro" | "enterprise" }
 */
router.post('/checkout', authJWT, requireActiveTenant, async (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const plan = req.body?.plan;
    const { url } = await billingService.createCheckout(tenantId, plan);
    return res.json({ url });
  } catch (e) {
    const status = e.statusCode && Number.isFinite(e.statusCode) ? e.statusCode : 500;
    if (status >= 500) {
      log.error({
        event: 'BILLING_CHECKOUT_ERROR',
        context: 'route',
        tenantId: req.user?.tenantId ?? null,
        error: e?.message || String(e),
        stack: e?.stack,
      });
    }
    return res.status(status).json({ error: e.message || 'Erro no checkout' });
  }
});

/**
 * POST /api/billing/webhook — registrado em server.js com body bruto (antes do express.json).
 */
export function billingWebhookHandler(req, res) {
  const raw = req.body;
  if (!Buffer.isBuffer(raw)) {
    log.warn({
      event: 'BILLING_WEBHOOK_ERROR',
      context: 'route',
      metadata: { reason: 'body_not_raw' },
    });
    return res.status(400).send('Webhook requer corpo bruto');
  }
  billingService
    .handleWebhook(raw, req.headers)
    .then((result) => res.json({ received: true, ...result }))
    .catch((err) => {
      const status = err.httpStatus === 500 ? 500 : 400;
      log.error({
        event: 'BILLING_WEBHOOK_ERROR',
        context: 'route',
        error: err?.message || String(err),
        stack: err?.stack,
        metadata: { httpStatus: status },
      });
      res.status(status).send(`Webhook error: ${err?.message || 'invalid'}`);
    });
}

export default router;
