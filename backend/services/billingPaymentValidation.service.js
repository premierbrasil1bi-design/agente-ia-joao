import Stripe from 'stripe';
import axios from 'axios';

function stripeSecret() {
  const v = String(process.env.STRIPE_SECRET_KEY || '').trim();
  if (!v) throw new Error('STRIPE_SECRET_KEY ausente');
  return v;
}

function asaasHttp() {
  const token = String(process.env.ASAAS_API_KEY || '').trim();
  if (!token) throw new Error('ASAAS_API_KEY ausente');
  const base = (
    String(process.env.ASAAS_BASE_URL || '').trim() || 'https://sandbox.asaas.com/api/v3'
  ).replace(/\/$/, '');
  return axios.create({
    baseURL: base,
    headers: { access_token: token, 'Content-Type': 'application/json' },
    timeout: 25_000,
  });
}

const ASAAS_CONFIRMED = new Set(['CONFIRMED', 'RECEIVED']);

/**
 * Garante que o pagamento está realmente confirmado na API do provedor (não só no payload do webhook).
 * @param {'stripe'|'asaas'} provider
 * @param {object} item
 * @returns {Promise<{ customerId: string|null, subscriptionId: string|null }>}
 */
export async function assertPaidForActivation(provider, item) {
  if (provider === 'stripe') {
    const stripe = new Stripe(stripeSecret());
    if (item.stripeSessionId) {
      const session = await stripe.checkout.sessions.retrieve(item.stripeSessionId, {
        expand: ['subscription'],
      });
      if (session.payment_status !== 'paid') {
        throw new BillingValidationError(`Stripe session não paga: ${session.payment_status}`);
      }
      const subRef = session.subscription;
      const subId = typeof subRef === 'string' ? subRef : subRef?.id ?? null;
      if (!subId) {
        throw new BillingValidationError('Stripe session sem assinatura');
      }
      const sub = await stripe.subscriptions.retrieve(subId);
      if (sub.status !== 'active') {
        throw new BillingValidationError(`Stripe subscription não ativa: ${sub.status}`);
      }
      const customerId =
        typeof session.customer === 'string' ? session.customer : session.customer?.id ?? item.customerId;
      return { customerId: customerId ?? null, subscriptionId: subId };
    }
    if (item.stripeSubscriptionId) {
      const sub = await stripe.subscriptions.retrieve(item.stripeSubscriptionId);
      if (sub.status !== 'active') {
        throw new BillingValidationError(`Stripe subscription não ativa: ${sub.status}`);
      }
      const customerId =
        typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? item.customerId;
      return { customerId: customerId ?? null, subscriptionId: sub.id };
    }
    throw new BillingValidationError('Webhook Stripe sem stripeSessionId/stripeSubscriptionId');
  }

  if (provider === 'asaas') {
    if (!item.asaasPaymentId) {
      throw new BillingValidationError('Webhook Asaas sem asaasPaymentId');
    }
    const http = asaasHttp();
    const { data: pay } = await http.get(`/payments/${item.asaasPaymentId}`);
    const st = String(pay?.status || '').toUpperCase();
    if (!ASAAS_CONFIRMED.has(st)) {
      throw new BillingValidationError(`Asaas pagamento não confirmado: ${pay?.status}`);
    }
    return {
      customerId: pay?.customer ?? item.customerId ?? null,
      subscriptionId: pay?.subscription ?? item.subscriptionId ?? null,
    };
  }

  throw new BillingValidationError(`Provedor desconhecido: ${provider}`);
}

export class BillingValidationError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'BillingValidationError';
  }
}
