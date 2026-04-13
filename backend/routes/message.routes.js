import express from 'express';
import {
  getMessage,
  getRecentMessages,
  getRegistryDebugInfo,
  getMessageStats,
  listMessages,
} from '../services/messageRegistry.js';
import { getProviderStatus, getProviderRuntimeMetrics } from '../services/providerManager.js';
import {
  getSnapshots,
  getTelemetry,
  resetTelemetry,
} from '../services/telemetry.service.js';

const router = express.Router();

function maskString(value) {
  const str = String(value || '');
  if (!str) return str;
  return str.length <= 4 ? '****' : `${str.slice(0, 2)}****${str.slice(-2)}`;
}

function sanitizeObject(input) {
  if (Array.isArray(input)) return input.map(sanitizeObject);
  if (!input || typeof input !== 'object') return input;
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    const key = String(k).toLowerCase();
    if (key.includes('token') || key.includes('phone') || key.includes('session') || key.includes('number')) {
      out[k] = maskString(v);
      continue;
    }
    out[k] = sanitizeObject(v);
  }
  return out;
}

router.get('/messages', async (req, res) => {
  try {
    const page = Number(req.query?.page || 1);
    const limit = Number(req.query?.limit || 20);
    const result = listMessages({ page, limit });
    return res.json({
      page: result.page,
      limit: result.limit,
      total: result.total,
      data: result.data.map((msg) => sanitizeObject(msg)),
    });
  } catch (err) {
    return res.status(500).json({
      error: err?.message || 'Erro interno',
    });
  }
});

router.get('/messages/:messageId', async (req, res) => {
  try {
    const { messageId } = req.params;
    const message = getMessage(messageId);

    if (!message) {
      return res.status(404).json({
        error: 'Mensagem não encontrada',
        messageId,
      });
    }

    return res.json({
      messageId,
      ...sanitizeObject(message),
    });
  } catch (err) {
    return res.status(500).json({
      error: err?.message || 'Erro interno',
    });
  }
});

router.get('/debug/messaging', async (req, res) => {
  try {
    const runtime = getProviderRuntimeMetrics();
    const providersStatus = await getProviderStatus();
    const lastMessages = getRecentMessages(10).map((msg) => sanitizeObject(msg));
    const stats = getMessageStats();
    const registryInfo = getRegistryDebugInfo();
    const snapshots = getSnapshots();
    return res.json({
      activeRequests: runtime.activeRequests,
      queueSize: runtime.queueSize,
      providersStatus,
      lastMessages,
      memoryUsage: process.memoryUsage(),
      uptime: process.uptime(),
      registry: {
        totalMessages: registryInfo.totalMessages,
        maxMessages: registryInfo.maxMessages,
        memoryUsageMB: registryInfo.memoryUsageMB,
        oldestMessageAge: registryInfo.oldestMessageAge,
      },
      messages: {
        total: stats.total,
        pending: stats.pending,
        sent: stats.sent,
        failed: stats.failed,
      },
      telemetry: getTelemetry(),
      snapshotsCount: snapshots.length,
    });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Erro interno' });
  }
});

router.get('/telemetry', async (req, res) => {
  try {
    const telemetry = getTelemetry();
    return res.json({
      messages: telemetry.messages,
      providers: telemetry.providers,
      registry: telemetry.registry,
      uptime: Date.now() - Number(telemetry?.system?.startedAt || Date.now()),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Erro interno' });
  }
});

router.get('/telemetry/snapshots', async (req, res) => {
  try {
    return res.json({ snapshots: getSnapshots() });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Erro interno' });
  }
});

router.post('/telemetry/reset', async (req, res) => {
  try {
    const adminKey = String(req.headers['x-admin-key'] || '');
    const expected = String(process.env.ADMIN_API_KEY || '');
    if (!expected || adminKey !== expected) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const metadata = {
      requestedBy: req.headers['x-admin-key'] ? 'admin-key' : 'unknown',
      ip: req.ip || req.connection?.remoteAddress || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
    };
    console.log(JSON.stringify({
      event: 'TELEMETRY_RESET_AUDIT',
      metadata,
      timestamp: new Date().toISOString(),
    }));
    const snapshot = resetTelemetry(metadata);
    return res.json({
      message: 'Telemetry reset successfully',
      snapshot,
    });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Erro interno' });
  }
});

export default router;
