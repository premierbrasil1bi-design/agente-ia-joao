import { Router } from 'express';
import { getSystemMetrics } from '../services/metrics.service.js';
import { getSnapshots } from '../services/monitoringSnapshotStore.js';
import { getSnapshots as getSnapshotsRedis } from '../services/redisMonitoringStore.js';
import { log } from '../utils/logger.js';
import { hasTenantFeature } from '../services/tenantFeatures.service.js';

const router = Router();

router.get('/history', async (req, res) => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId || null;
    if (!tenantId) {
      return res.status(401).json({ error: 'Tenant não identificado.' });
    }
    const extendedHistory = await hasTenantFeature(tenantId, 'extendedMonitoringHistory');
    const maxCap = extendedHistory ? 60 : 30;
    const raw = req.query?.limit;
    const parsed = raw != null ? parseInt(String(raw), 10) : 30;
    const limit = Number.isFinite(parsed) ? Math.min(Math.max(1, parsed), maxCap) : Math.min(30, maxCap);

    log.info({
      event: 'MONITORING_HISTORY_REQUESTED',
      context: 'route',
      tenantId,
      metadata: { limit },
    });

    let snapshots = [];
    try {
      snapshots = await getSnapshotsRedis(tenantId, limit);
    } catch (err) {
      log.warn({
        event: 'REDIS_MONITORING_FALLBACK',
        context: 'route',
        tenantId,
        metadata: { reason: err?.message || 'redis_unavailable' },
      });
      snapshots = getSnapshots(tenantId, limit);
    }
    return res.status(200).json({ snapshots });
  } catch (err) {
    log.error({
      event: 'MONITORING_HISTORY_ERROR',
      context: 'route',
      tenantId: req.tenantId || req.user?.tenantId || null,
      error: err?.message || String(err),
      stack: err?.stack,
    });
    return res.status(500).json({ error: 'Erro ao obter histórico de monitoramento.' });
  }
});

router.get('/overview', async (req, res) => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId || null;
    const metrics = await getSystemMetrics(tenantId);
    return res.status(200).json(metrics);
  } catch (err) {
    log.error({
      event: 'MONITORING_OVERVIEW_ERROR',
      context: 'route',
      tenantId: req.tenantId || req.user?.tenantId || null,
      error: err?.message || String(err),
      stack: err?.stack,
    });
    return res.status(500).json({ error: 'Erro ao obter métricas de monitoramento.' });
  }
});

export default router;
