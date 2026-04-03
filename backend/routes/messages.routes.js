import { Router } from 'express';
import * as channelRepo from '../repositories/channel.repository.js';
import * as inboxRepo from '../repositories/inboxMessages.repository.js';
import * as messageStatusEventsRepo from '../repositories/messageStatusEvents.repository.js';
import { emitChannelSocketEvent } from '../utils/channelRealtime.js';
import { sendWhatsAppTextForChannel } from '../services/whatsappOutbound.service.js';
import {
  buildConversationId,
  normalizeChannelType,
  normalizeMessageStatus,
} from '../utils/inboxNormalization.js';
import { normalizeProviderMessageStatus } from '../utils/normalizeProviderMessageStatus.js';
import { dispatchAlert } from '../services/alertDispatcher.js';

const router = Router();
const alertsStore = new Map();

function buildSlaFromTimeline(createdAt, events) {
  const toMs = (v) => (v ? new Date(v).getTime() : null);
  const createdMs = toMs(createdAt);
  const sentMs = toMs(events.find((e) => e.event_type === 'SENT')?.created_at);
  const deliveredMs = toMs(events.find((e) => e.event_type === 'DELIVERED')?.created_at);
  const readMs = toMs(events.find((e) => e.event_type === 'READ')?.created_at);
  return {
    sentInMs: createdMs != null && sentMs != null ? Math.max(0, sentMs - createdMs) : null,
    deliveredInMs: sentMs != null && deliveredMs != null ? Math.max(0, deliveredMs - sentMs) : null,
    readInMs: deliveredMs != null && readMs != null ? Math.max(0, readMs - deliveredMs) : null,
  };
}

function calculatePercentiles(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return { p50: null, p95: null, p99: null };
  }

  const sorted = [...values].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return { p50: null, p95: null, p99: null };

  const median = () => {
    const mid = Math.floor(n / 2);
    if (n % 2 === 0) return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
    return sorted[mid];
  };
  const pickByRatio = (ratio) => {
    const idx = Math.min(n - 1, Math.max(0, Math.floor(ratio * n)));
    return sorted[idx];
  };

  return {
    p50: median(),
    p95: pickByRatio(0.95),
    p99: pickByRatio(0.99),
  };
}

function classifyDataQuality(sampleSize) {
  if (sampleSize >= 1000) return 'HIGH';
  if (sampleSize >= 100) return 'MEDIUM';
  return 'LOW';
}

function evaluateMetrics(metrics, { tenantId, channelId = null, channelLabel = null }) {
  const now = new Date().toISOString();
  const alerts = [];
  const p95Delivery = Number(metrics?.deliveryPercentiles?.p95 ?? 0);
  const failedRate = Number(metrics?.failedRate ?? 0);
  const deliveredRate = Number(metrics?.deliveredRate ?? 0);
  const target = channelLabel || channelId || 'tenant';

  if (Number.isFinite(p95Delivery) && p95Delivery > 10000) {
    alerts.push({
      id: `alert:p95:${tenantId}:${channelId || 'all'}`,
      tenantId,
      channelId,
      type: 'P95_DELIVERY_HIGH',
      severity: 'HIGH',
      message: `p95 de delivery alto em ${target} (${Math.round(p95Delivery)}ms).`,
      createdAt: now,
    });
  }

  if (Number.isFinite(failedRate) && failedRate > 0.05) {
    alerts.push({
      id: `alert:failed:${tenantId}:${channelId || 'all'}`,
      tenantId,
      channelId,
      type: 'FAILED_RATE_HIGH',
      severity: 'HIGH',
      message: `Taxa de falha alta em ${target} (${(failedRate * 100).toFixed(1)}%).`,
      createdAt: now,
    });
  }

  if (Number.isFinite(deliveredRate) && deliveredRate < 0.9) {
    alerts.push({
      id: `alert:delivered:${tenantId}:${channelId || 'all'}`,
      tenantId,
      channelId,
      type: 'DELIVERED_RATE_LOW',
      severity: 'MEDIUM',
      message: `Taxa de entrega baixa em ${target} (${(deliveredRate * 100).toFixed(1)}%).`,
      createdAt: now,
    });
  }

  return alerts;
}

function upsertAlerts(tenantId, alerts) {
  const key = String(tenantId);
  const current = new Map((alertsStore.get(key) || []).map((a) => [a.id, a]));
  const toDispatch = [];
  for (const alert of alerts) {
    const existing = current.get(alert.id);
    const merged = {
      ...existing,
      ...alert,
      dispatched: existing?.dispatched === true,
    };
    if (!existing || merged.dispatched !== true) {
      merged.dispatched = true;
      toDispatch.push(merged);
    }
    current.set(alert.id, merged);
  }
  const sorted = [...current.values()].sort((a, b) => {
    const weight = (s) => (s === 'HIGH' ? 2 : s === 'MEDIUM' ? 1 : 0);
    return weight(b.severity) - weight(a.severity);
  });
  alertsStore.set(key, sorted);
  if (toDispatch.length > 0) {
    Promise.allSettled(toDispatch.map((a) => dispatchAlert(a))).catch(() => {});
  }
  return sorted;
}

router.get('/conversations', async (req, res) => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId;
    if (!tenantId) return res.status(401).json({ error: 'Tenant não identificado.' });
    const channelId = req.query.channelId ? String(req.query.channelId) : null;
    const data = await inboxRepo.listConversationsByTenant(tenantId, channelId);
    const normalized = data.map((c) => {
      const channelType = normalizeChannelType(c.channel_type);
      const participantId = String(c.contact || '');
      return {
        id: buildConversationId(c.channel_id, participantId),
        tenantId,
        channelId: c.channel_id,
        channelType,
        participantId,
        participantName: participantId,
        participantAvatar: null,
        lastMessage: c.last_message,
        lastMessageAt: c.timestamp,
        unreadCount: 0,
        // compat legado
        channel_id: c.channel_id,
        contact: c.contact,
        last_message: c.last_message,
        timestamp: c.timestamp,
        status: normalizeMessageStatus(c.status),
        direction: c.direction,
      };
    });
    return res.status(200).json(normalized);
  } catch (err) {
    console.error('[messages] conversations:', err.message);
    return res.status(500).json({ error: 'Falha ao listar conversas.' });
  }
});

router.get('/', async (req, res) => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId;
    if (!tenantId) return res.status(401).json({ error: 'Tenant não identificado.' });
    const channelId = String(req.query.channelId || '');
    const participantId = String(req.query.participantId || req.query.contact || '');
    if (!channelId || !participantId) {
      return res.status(400).json({ error: 'channelId e participantId são obrigatórios.' });
    }
    const data = await inboxRepo.listMessagesByConversation({
      tenantId,
      channelId,
      contact: participantId,
      limit: Number(req.query.limit || 100),
      offset: Number(req.query.offset || 0),
    });
    const normalized = data.map((m) => {
      const channelType = normalizeChannelType(m.channel_type);
      const senderType =
        m.direction === 'inbound'
          ? 'customer'
          : 'agent';
      return {
        id: m.id,
        tenantId: m.tenant_id,
        channelId: m.channel_id,
        channelType,
        conversationId: buildConversationId(m.channel_id, m.contact),
        senderType,
        participantId: m.contact,
        participantName: m.contact,
        participantHandle: null,
        content: m.content,
        contentType: 'text',
        timestamp: m.timestamp,
        status: normalizeMessageStatus(m.status),
        // compat legado
        tenant_id: m.tenant_id,
        channel_id: m.channel_id,
        contact: m.contact,
        direction: m.direction,
      };
    });
    return res.status(200).json(normalized);
  } catch (err) {
    console.error('[messages] list:', err.message);
    return res.status(500).json({ error: 'Falha ao listar mensagens.' });
  }
});

router.post('/send', async (req, res) => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId;
    if (!tenantId) return res.status(401).json({ error: 'Tenant não identificado.' });
    const { channelId, participantId, contact, message } = req.body || {};
    const participant = String(participantId || contact || '');
    if (!channelId || !participant || !message) {
      return res.status(400).json({ error: 'channelId, participantId e message são obrigatórios.' });
    }

    const channel = await channelRepo.findById(channelId, tenantId);
    if (!channel) return res.status(404).json({ error: 'Canal não encontrado.' });

    const provider = String(channel.provider || normalizeChannelType(channel.type));
    const sendResult = await sendWhatsAppTextForChannel(channel, participant, String(message));
    const externalMessageId =
      sendResult?.id ||
      sendResult?.messageId ||
      sendResult?.key?.id ||
      sendResult?.data?.id ||
      null;
    const initialStatus = normalizeProviderMessageStatus(provider, sendResult?.status || 'sent');

    const saved = await inboxRepo.createMessage({
      tenantId,
      agentId: channel.agent_id,
      channelId: channel.id,
      contact: participant,
      direction: 'outbound',
      content: String(message),
      status: initialStatus,
      conversationId: buildConversationId(channel.id, participant),
      provider,
      externalMessageId,
    });
    const channelType = normalizeChannelType(channel.type);
    const conversationId = buildConversationId(saved.channel_id, saved.contact);

    const payload = {
      messageId: saved.id,
      channelId: saved.channel_id,
      channelType,
      conversationId,
      participantId: saved.contact,
      tenantId: saved.tenant_id,
      contact: saved.contact,
      message: saved.content,
      direction: saved.direction,
      timestamp: saved.timestamp,
      status: saved.status,
    };
    emitChannelSocketEvent('message:new', payload);
    await messageStatusEventsRepo.createStatusEvent({
      messageId: saved.id,
      tenantId: saved.tenant_id,
      provider,
      eventType: normalizeMessageStatus(saved.status),
      rawPayload: sendResult || {},
    });

    return res.status(200).json({
      success: true,
      message: {
        id: saved.id,
        tenantId: saved.tenant_id,
        channelId: saved.channel_id,
        channelType,
        conversationId,
        senderType: 'agent',
        participantId: saved.contact,
        participantName: saved.contact,
        participantHandle: null,
        content: saved.content,
        contentType: 'text',
        timestamp: saved.timestamp,
        status: normalizeMessageStatus(saved.status),
      },
    });
  } catch (err) {
    if (err?.code === 'MESSAGE_LIMIT_EXCEEDED') {
      return res.status(err.httpStatus || 429).json({
        error: err.code,
        message: err.message,
        details: err.details || null,
      });
    }
    console.error('[messages] send:', err.message);
    return res.status(500).json({ error: 'Falha ao enviar mensagem.' });
  }
});

router.get('/metrics', async (req, res) => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId;
    if (!tenantId) return res.status(401).json({ error: 'Tenant não identificado.' });
    const channelId = req.query.channelId ? String(req.query.channelId) : null;
    const from = req.query.from ? String(req.query.from) : null;
    const to = req.query.to ? String(req.query.to) : null;

    const metrics = await inboxRepo.getMessagesMetrics({
      tenantId,
      channelId,
      from,
      to,
    });

    const safeTotal = Number(metrics.totalMessages || 0);
    const ratio = (value) => (safeTotal > 0 ? Number((value / safeTotal).toFixed(4)) : 0);
    const MAX_REASONABLE_MS = 24 * 60 * 60 * 1000;
    const originalDeliveryTimes = metrics.deliveryTimesMs || [];
    const originalReadTimes = metrics.readTimesMs || [];
    const deliveryTimes = originalDeliveryTimes.filter((v) => v <= MAX_REASONABLE_MS);
    const readTimes = originalReadTimes.filter((v) => v <= MAX_REASONABLE_MS);
    const deliverySampleSize = deliveryTimes.length;
    const readSampleSize = readTimes.length;
    const coverage = (sampleSize) => (safeTotal > 0 ? Number((sampleSize / safeTotal).toFixed(4)) : 0);
    const deliveryOutliersIgnored = Math.max(0, originalDeliveryTimes.length - deliverySampleSize);
    const readOutliersIgnored = Math.max(0, originalReadTimes.length - readSampleSize);
    const outlierRate = (ignored, totalOriginal) =>
      totalOriginal > 0 ? Number((ignored / totalOriginal).toFixed(4)) : 0;

    const payload = {
      totalMessages: safeTotal,
      deliveredRate: ratio(Number(metrics.deliveredCount || 0)),
      readRate: ratio(Number(metrics.readCount || 0)),
      failedRate: ratio(Number(metrics.failedCount || 0)),
      avgDeliveryTime: metrics.avgDeliveryTimeMs != null ? Number(metrics.avgDeliveryTimeMs) : null,
      avgReadTime: metrics.avgReadTimeMs != null ? Number(metrics.avgReadTimeMs) : null,
      deliveryPercentiles: calculatePercentiles(deliveryTimes),
      readPercentiles: calculatePercentiles(readTimes),
      deliverySampleSize,
      readSampleSize,
      deliveryCoverage: coverage(deliverySampleSize),
      readCoverage: coverage(readSampleSize),
      dataQuality: {
        delivery: classifyDataQuality(deliverySampleSize),
        read: classifyDataQuality(readSampleSize),
      },
      deliveryOutliersIgnored,
      readOutliersIgnored,
      deliveryOutlierRate: outlierRate(deliveryOutliersIgnored, originalDeliveryTimes.length),
      readOutlierRate: outlierRate(readOutliersIgnored, originalReadTimes.length),
    };
    const channelLabel = channelId ? (await channelRepo.findById(channelId, tenantId))?.name || null : null;
    const evaluated = evaluateMetrics(payload, { tenantId, channelId, channelLabel });
    upsertAlerts(tenantId, evaluated);
    return res.status(200).json(payload);
  } catch (err) {
    console.error('[messages] metrics:', err.message);
    return res.status(500).json({ error: 'Falha ao calcular métricas.' });
  }
});

router.get('/alerts', async (req, res) => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId;
    if (!tenantId) return res.status(401).json({ error: 'Tenant não identificado.' });
    const channelId = req.query.channelId ? String(req.query.channelId) : null;
    let alerts = alertsStore.get(String(tenantId)) || [];
    if (channelId) alerts = alerts.filter((a) => String(a.channelId || '') === channelId);
    return res.status(200).json(alerts);
  } catch (err) {
    console.error('[messages] alerts:', err.message);
    return res.status(500).json({ error: 'Falha ao listar alertas.' });
  }
});

router.get('/:id/status-events', async (req, res) => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId;
    if (!tenantId) return res.status(401).json({ error: 'Tenant não identificado.' });
    const messageId = String(req.params.id || '');
    if (!messageId) return res.status(400).json({ error: 'messageId é obrigatório.' });

    const message = await inboxRepo.findMessageByIdForTenant(messageId, tenantId);
    if (!message) return res.status(404).json({ error: 'Mensagem não encontrada.' });

    const events = await messageStatusEventsRepo.listStatusEventsByMessage({ messageId, tenantId });
    return res.status(200).json({
      messageId: message.id,
      statusAtual: normalizeMessageStatus(message.status),
      timeline: events.map((ev) => ({
        eventType: normalizeMessageStatus(ev.event_type),
        provider: ev.provider,
        createdAt: ev.created_at,
        rawPayload: ev.raw_payload || {},
      })),
    });
  } catch (err) {
    console.error('[messages] status-events:', err.message);
    return res.status(500).json({ error: 'Falha ao buscar eventos de status.' });
  }
});

router.get('/:id/timeline', async (req, res) => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId;
    if (!tenantId) return res.status(401).json({ error: 'Tenant não identificado.' });
    const messageId = String(req.params.id || '');
    if (!messageId) return res.status(400).json({ error: 'messageId é obrigatório.' });

    const message = await inboxRepo.findMessageByIdForTenant(messageId, tenantId);
    if (!message) return res.status(404).json({ error: 'Mensagem não encontrada.' });

    const events = await messageStatusEventsRepo.listStatusEventsByMessage({ messageId, tenantId });
    const timeline = [
      { type: 'CREATED', timestamp: message.created_at || null },
      ...events.map((ev) => ({
        type: normalizeMessageStatus(ev.event_type),
        timestamp: ev.created_at,
      })),
    ];
    const sla = buildSlaFromTimeline(message.created_at, events);

    return res.status(200).json({
      messageId: message.id,
      provider: message.provider || 'unknown',
      timeline,
      sla,
    });
  } catch (err) {
    console.error('[messages] timeline:', err.message);
    return res.status(500).json({ error: 'Falha ao montar timeline operacional.' });
  }
});

export default router;

