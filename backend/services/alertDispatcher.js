/**
 * Alert dispatcher (stub).
 * Estrutura preparada para futuros providers externos:
 * - webhookDispatcher
 * - emailDispatcher
 * - whatsappDispatcher
 */
import crypto from 'crypto';
import { getWebhookConfig } from './alertWebhookConfigStore.js';

async function webhookDispatcher(alert) {
  const cfg = getWebhookConfig(alert?.tenantId);
  if (!cfg || cfg.isActive !== true || !cfg.url) {
    return { ok: true, provider: 'webhook', skipped: true, reason: 'not-configured', alertId: alert?.id };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const body = {
      type: 'ALERT',
      severity: alert?.severity || 'MEDIUM',
      message: alert?.message || '',
      tenantId: alert?.tenantId || null,
      channelId: alert?.channelId || null,
      createdAt: alert?.createdAt || new Date().toISOString(),
    };
    const payloadString = JSON.stringify(body);
    const timestamp = String(Date.now());
    const headers = {
      'Content-Type': 'application/json',
      'x-alert-timestamp': timestamp,
    };
    if (cfg.secret) {
      const signature = crypto.createHmac('sha256', String(cfg.secret)).update(payloadString).digest('hex');
      headers['x-alert-signature'] = signature;
    }
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers,
      body: payloadString,
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn('[ALERT DISPATCH][webhook] non-2xx response', {
        alertId: alert?.id,
        status: res.status,
      });
      return { ok: false, provider: 'webhook', alertId: alert?.id, status: res.status };
    }
    return { ok: true, provider: 'webhook', alertId: alert?.id };
  } catch (err) {
    console.warn('[ALERT DISPATCH][webhook] error', {
      alertId: alert?.id,
      error: err?.message || String(err),
    });
    return { ok: false, provider: 'webhook', alertId: alert?.id, error: err?.message || String(err) };
  } finally {
    clearTimeout(timeout);
  }
}

function emailDispatcher(alert) {
  return { ok: true, provider: 'email', skipped: true, alertId: alert?.id };
}

function whatsappDispatcher(alert) {
  return { ok: true, provider: 'whatsapp', skipped: true, alertId: alert?.id };
}

const dispatchers = [webhookDispatcher, emailDispatcher, whatsappDispatcher];

export async function dispatchAlert(alert) {
  const payload = {
    id: alert?.id || null,
    tenantId: alert?.tenantId || null,
    channelId: alert?.channelId || null,
    type: alert?.type || 'UNKNOWN',
    severity: alert?.severity || 'MEDIUM',
    message: alert?.message || '',
    createdAt: alert?.createdAt || new Date().toISOString(),
  };

  console.info('[ALERT DISPATCH]', payload);

  // Webhook ativo (real) + outros dispatchers stubs para expansão futura.
  await Promise.all(dispatchers.map(async (fn) => fn(payload)));
  return { ok: true };
}

