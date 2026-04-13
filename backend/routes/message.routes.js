import express from 'express';
import { pool } from '../db/pool.js';
import {
  getMessage,
  getRecentMessages,
  getRegistryDebugInfo,
  getMessageStats,
  listMessages,
} from '../services/messageRegistry.js';
import { getProviderStatus, getProviderRuntimeMetrics } from '../services/providerManager.js';
import { getSessionMonitorDebug, getSessionMonitorState } from '../services/sessionMonitor.js';
import { ensureSession, getSessionOrchestratorRuntime } from '../services/sessionOrchestrator.js';
import { getAdapter } from '../providers/sessionAdapters/index.js';
import { resolveProvider } from '../providers/resolveProvider.js';
import { resolveSessionName } from '../utils/resolveSessionName.js';
import { sessionQueue } from '../queues/session.queue.js';
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

function resolveChannelSessionName(channel, provider) {
  const providerLc = String(provider || '').toLowerCase();
  if (providerLc === 'waha') return resolveSessionName(channel);
  return (
    String(channel?.external_id || '').trim() ||
    String(channel?.instance || '').trim() ||
    String(channel?.id || '').trim() ||
    'default'
  );
}

async function findChannelForOperations(channelId) {
  const { rows } = await pool.query(
    `SELECT id, tenant_id, provider, external_id, instance, type
     FROM channels
     WHERE id = $1
     LIMIT 1`,
    [channelId],
  );
  return rows[0] ?? null;
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

router.get('/messages/metrics', async (req, res) => {
  try {
    const now = Date.now();
    const defaultFrom = new Date(now - 7 * 86_400_000).toISOString();
    const defaultTo = new Date(now).toISOString();
    const from = String(req.query?.from || '').trim() || defaultFrom;
    const to = String(req.query?.to || '').trim() || defaultTo;
    const channelIdRaw = req.query?.channelId;
    const channelId = channelIdRaw != null && String(channelIdRaw).trim() !== ''
      ? String(channelIdRaw).trim()
      : undefined;

    console.log(JSON.stringify({
      event: 'MESSAGES_METRICS_FETCH',
      timestamp: new Date().toISOString(),
      from,
      to,
      channelId: channelId || null,
    }));

    const stats = getMessageStats();
    const telemetryData = getTelemetry();
    const tm = telemetryData?.messages || {};

    const sent = Number(stats?.sent || 0);
    const failed = Number(stats?.failed || 0);
    const received = Number(tm.received || 0);
    const totalMessages = Number(stats?.total || 0);

    const data = {
      totalMessages,
      sent,
      received,
      failed,
      period: { from, to },
      ...(channelId ? { channelId } : {}),
    };

    return res.json({
      success: true,
      data,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: 'Erro ao carregar métricas.',
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

router.get('/debug/sessions', async (req, res) => {
  try {
    const debug = await getSessionMonitorDebug();
    const runtime = getSessionOrchestratorRuntime();
    let queue = { waiting: 0, active: 0, failed: 0 };
    try {
      const [waiting, active, failed] = await Promise.all([
        sessionQueue.getWaitingCount(),
        sessionQueue.getActiveCount(),
        sessionQueue.getFailedCount(),
      ]);
      queue = { waiting, active, failed };
    } catch {
      queue = { waiting: 0, active: 0, failed: 0 };
    }
    return res.json({
      sessions: debug.sessions,
      backoff: debug.backoff,
      metrics: debug.metrics,
      monitor: getSessionMonitorState(),
      providers: runtime.providers,
      locks: runtime.locks,
      cache: runtime.cache,
      redis: runtime.redis || { connected: false },
      queue,
    });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Erro interno' });
  }
});

router.post('/sessions/:channelId/reconnect', async (req, res) => {
  try {
    const channelId = String(req.params.channelId || '').trim();
    if (!channelId) return res.status(400).json({ error: 'channelId inválido' });
    const channel = await findChannelForOperations(channelId);
    if (!channel) return res.status(404).json({ error: 'Canal não encontrado' });
    const provider = String(resolveProvider(channel) || '').toLowerCase();
    if (!provider) return res.status(400).json({ error: 'Provider não definido no canal' });
    const sessionName = resolveChannelSessionName(channel, provider);
    const out = await ensureSession({
      provider,
      sessionName,
      channelId: channel.id,
      tenantId: channel.tenant_id,
    });
    return res.json({
      success: true,
      channelId,
      providerRequested: provider,
      providerUsed: out?.providerUsed || provider,
      status: out?.status || 'UNKNOWN',
      connected: Boolean(out?.connected),
      qrCode: out?.qr || null,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Falha ao reconectar sessão.' });
  }
});

router.post('/sessions/:channelId/refresh', async (req, res) => {
  try {
    const channelId = String(req.params.channelId || '').trim();
    if (!channelId) return res.status(400).json({ error: 'channelId inválido' });
    const channel = await findChannelForOperations(channelId);
    if (!channel) return res.status(404).json({ error: 'Canal não encontrado' });
    const provider = String(resolveProvider(channel) || '').toLowerCase();
    if (!provider) return res.status(400).json({ error: 'Provider não definido no canal' });
    const sessionName = resolveChannelSessionName(channel, provider);
    const adapter = getAdapter(provider);
    const session = await adapter.getSession(sessionName);
    return res.json({
      success: true,
      channelId,
      provider,
      sessionName,
      status: String(session?.status || 'UNKNOWN').toUpperCase(),
      exists: Boolean(session?.exists),
    });
  } catch (err) {
    return res.status(500).json({ error: 'Falha ao atualizar status da sessão.' });
  }
});

router.get('/sessions/:channelId/qrcode', async (req, res) => {
  try {
    const channelId = String(req.params.channelId || '').trim();
    if (!channelId) return res.status(400).json({ error: 'channelId inválido' });
    const channel = await findChannelForOperations(channelId);
    if (!channel) return res.status(404).json({ error: 'Canal não encontrado' });
    const provider = String(resolveProvider(channel) || '').toLowerCase();
    if (!provider) return res.status(400).json({ error: 'Provider não definido no canal' });
    const sessionName = resolveChannelSessionName(channel, provider);
    const out = await ensureSession({
      provider,
      sessionName,
      channelId: channel.id,
      tenantId: channel.tenant_id,
    });
    if (out?.status === 'WORKING') {
      return res.json({ success: true, status: 'connected', connected: true, provider: out.providerUsed || provider });
    }
    if (out?.status === 'QR' && out?.qr) {
      return res.json({
        success: true,
        status: 'waiting_qr',
        provider: out.providerUsed || provider,
        qrCode: out.qr,
        qr: out.qr,
      });
    }
    return res.status(404).json({ success: false, error: 'QR não disponível no momento.' });
  } catch {
    return res.status(500).json({ error: 'Falha ao obter QR da sessão.' });
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
