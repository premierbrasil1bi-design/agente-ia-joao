import axios from 'axios';
import { PaymentProvider } from './PaymentProvider.js';
import { normalizePlanKey } from '../../config/plans.config.js';
import { asaasBodyToWebhookEnvelope } from './asaasWebhookItems.js';

function getEnv(name, required = true) {
  const v = String(process.env[name] || '').trim();
  if (!v && required) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }
  return v || null;
}

function baseUrl() {
  return (
    getEnv('ASAAS_BASE_URL', false) || 'https://sandbox.asaas.com/api/v3'
  ).replace(/\/$/, '');
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

function valueForPlan(plan) {
  const p = normalizePlanKey(plan);
  const raw =
    p === 'enterprise'
      ? getEnv('ASAAS_PLAN_ENTERPRISE_VALUE')
      : getEnv('ASAAS_PLAN_PRO_VALUE');
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Valor Asaas inválido para o plano ${p}`);
  }
  return n;
}

function billingAppBaseUrl() {
  return (
    String(process.env.BILLING_APP_BASE_URL || process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || '').trim() ||
    'http://localhost:5173'
  );
}

function nextDueDateIsoDate() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function defaultBillingType() {
  return String(process.env.ASAAS_SUBSCRIPTION_BILLING_TYPE || 'UNDEFINED').trim() || 'UNDEFINED';
}

export class AsaasProvider extends PaymentProvider {
  async getCustomer(tenant) {
    const id = tenant?.billing_customer_id;
    if (!id || tenant?.billing_provider !== 'asaas') return null;
    try {
      const http = asaasClient();
      const { data } = await http.get(`/customers/${id}`);
      if (!data?.id) return null;
      return { id: data.id };
    } catch {
      return null;
    }
  }

  async createCustomer(tenant) {
    const http = asaasClient();
    const { data } = await http.post('/customers', {
      name: tenant?.name ? String(tenant.name).slice(0, 256) : `Tenant ${tenant.id}`,
      externalReference: String(tenant.id),
      notificationDisabled: true,
    });
    if (!data?.id) throw new Error('Asaas não retornou customer id');
    return { id: data.id };
  }

  async createCheckoutSession(tenant, plan) {
    const http = asaasClient();
    const p = normalizePlanKey(plan);

    let customerId = tenant.billing_provider === 'asaas' ? tenant.billing_customer_id : null;
    if (!customerId) {
      const c = await this.createCustomer(tenant);
      customerId = c.id;
    }

    const externalReference = `${tenant.id}|${p}`;
    const { data: sub } = await http.post('/subscriptions', {
      customer: customerId,
      billingType: defaultBillingType(),
      cycle: String(process.env.ASAAS_SUBSCRIPTION_CYCLE || 'MONTHLY').trim() || 'MONTHLY',
      value: valueForPlan(p),
      nextDueDate: nextDueDateIsoDate(),
      description: `Assinatura ${p} — ${tenant.name || tenant.id}`,
      externalReference,
    });

    if (!sub?.id) throw new Error('Asaas não retornou assinatura');

    const { data: payments } = await http.get('/payments', {
      params: { subscription: sub.id, limit: 5 },
    });

    const list = Array.isArray(payments?.data) ? payments.data : [];
    const first = list[0];
    const url =
      first?.invoiceUrl ||
      first?.bankSlipUrl ||
      `${billingAppBaseUrl().replace(/\/$/, '')}/?billing=asaas_pending&subscription=${encodeURIComponent(sub.id)}`;

    return {
      url,
      customerId,
      subscriptionId: sub.id,
    };
  }

  async parseWebhook(rawBody, headers) {
    const expected = getEnv('ASAAS_WEBHOOK_TOKEN');
    const token = headers['asaas-access-token'];
    const tok = Array.isArray(token) ? token[0] : token;
    if (!tok || tok !== expected) {
      throw new Error('Token de webhook Asaas inválido');
    }

    let body;
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new Error('Corpo do webhook Asaas inválido');
    }

    const { items, providerEventId, envelopeType } = await asaasBodyToWebhookEnvelope(body);
    let serializable = body;
    try {
      serializable = JSON.parse(JSON.stringify(body));
    } catch {
      /* keep */
    }

    return {
      providerEventId,
      payload: serializable,
      items,
      envelopeType,
    };
  }

  async cancelExternalSubscription(subscriptionId) {
    const http = asaasClient();
    await http.delete(`/subscriptions/${subscriptionId}`);
  }
}
