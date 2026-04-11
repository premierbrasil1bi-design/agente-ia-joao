import axios from 'axios';
import { normalizePlanKey } from '../../config/plans.config.js';

function getEnv(name, required = true) {
  const v = String(process.env[name] || '').trim();
  if (!v && required) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }
  return v || null;
}

function baseUrl() {
  return (getEnv('ASAAS_BASE_URL', false) || 'https://sandbox.asaas.com/api/v3').replace(/\/$/, '');
}

function asaasClient() {
  const token = getEnv('ASAAS_API_KEY');
  return axios.create({
    baseURL: baseUrl(),
    headers: {
      access_token: token,
      'Content-Type': 'application/json',
    },
    timeout: 25_000,
  });
}

function parseExternalRef(ref) {
  const s = String(ref || '').trim();
  const i = s.indexOf('|');
  if (i <= 0) return null;
  const tenantId = s.slice(0, i).trim();
  const plan = s.slice(i + 1).trim();
  if (!tenantId || !plan) return null;
  return { tenantId, plan: normalizePlanKey(plan) };
}

/**
 * Corpo JSON do webhook Asaas (após validar token) → itens normalizados.
 * @param {object} body
 */
export async function asaasBodyToWebhookEnvelope(body) {
  const event = body?.event;
  const http = asaasClient();
  /** @type {object[]} */
  const items = [];

  if (event === 'PAYMENT_CONFIRMED' || event === 'PAYMENT_RECEIVED') {
    const payment = body.payment || body;
    const ref = parseExternalRef(payment?.externalReference);
    const subId = payment?.subscription;
    let tenantId = ref?.tenantId ?? null;
    let plan = ref?.plan ?? null;
    let customerId = payment?.customer ?? null;

    if ((!tenantId || !plan) && subId) {
      try {
        const { data: sub } = await http.get(`/subscriptions/${subId}`);
        const parsed = parseExternalRef(sub?.externalReference);
        if (parsed) {
          tenantId = parsed.tenantId;
          plan = parsed.plan;
        }
        customerId = customerId || sub?.customer || null;
      } catch {
        /* ignore */
      }
    }

    if (tenantId && plan && (plan === 'pro' || plan === 'enterprise')) {
      const pid = payment?.id || 'unknown';
      items.push({
        type: 'payment_success',
        tenantId,
        plan,
        customerId,
        subscriptionId: subId || null,
        externalEventId: String(pid),
        asaasPaymentId: String(pid),
      });
    }

    const providerEventId = `${event}_${payment?.id || 'nopay'}`;
    return { items, providerEventId, envelopeType: String(event) };
  }

  if (event === 'SUBSCRIPTION_DELETED' || event === 'SUBSCRIPTION_INACTIVATED') {
    const sub = body.subscription || body;
    const parsed = parseExternalRef(sub?.externalReference);
    if (parsed?.tenantId) {
      items.push({
        type: 'subscription_canceled',
        tenantId: parsed.tenantId,
        plan: parsed.plan,
        customerId: sub?.customer ?? null,
        subscriptionId: sub?.id ?? null,
        externalEventId: String(sub?.id || 'sub'),
        asaasSubscriptionId: sub?.id ? String(sub.id) : null,
      });
    }
    const providerEventId = `${event}_${sub?.id || 'nosub'}`;
    return { items, providerEventId, envelopeType: String(event) };
  }

  return {
    items: [],
    providerEventId: `asaas_${event || 'unknown'}_${body?.id || Date.now()}`,
    envelopeType: String(event || 'unknown'),
  };
}
