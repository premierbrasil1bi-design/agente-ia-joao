/**
 * Rotas internas WAHA (métricas / ops).
 * GET /api/internal/waha/metrics — protegido por WAHA_INTERNAL_METRICS_KEY (header x-waha-internal-key) ou JWT global admin.
 */

import { Router } from 'express';
import globalAdminAuth from '../middlewares/globalAdminAuth.js';
import { getWahaMetrics, getWahaGlobalStatus } from '../services/wahaMetrics.service.js';

const router = Router();

function internalWahaMetricsAuth(req, res, next) {
  const expected = process.env.WAHA_INTERNAL_METRICS_KEY?.trim();
  if (expected) {
    const got = String(req.headers['x-waha-internal-key'] || req.get('x-waha-internal-key') || '').trim();
    if (got === expected) return next();
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return globalAdminAuth(req, res, next);
}

router.get('/waha/metrics', internalWahaMetricsAuth, (req, res) => {
  const m = getWahaMetrics();
  res.status(200).json({
    qrRequests: m.qrRequests,
    qrSuccess: m.qrSuccess,
    qrPending: m.qrPending,
    qrFailures: m.qrFailures,
    unstable: m.unstable,
    offline: m.offline,
    lastDuration: m.lastDuration,
  });
});

router.get('/waha/status', internalWahaMetricsAuth, (req, res) => {
  res.status(200).json(getWahaGlobalStatus());
});

export default router;
