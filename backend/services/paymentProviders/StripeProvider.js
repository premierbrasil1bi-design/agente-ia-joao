import Stripe from 'stripe';
import { PaymentProvider } from './PaymentProvider.js';
import { normalizePlanKey } from '../../config/plans.config.js';
import { stripeEventToWebhookItems } from './stripeWebhookItems.js';

function getEnv(name, required = true) {
  const v = String(process.env[name] || '').trim();
  if (!v && required) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }
  return v || null;
}

function stripeClient() {
  const key = getEnv('STRIPE_SECRET_KEY');
  return new Stripe(key);
}

function priceIdForPlan(plan) {
  const p = normalizePlanKey(plan);
  if (p === 'enterprise') return getEnv('STRIPE_PRICE_ENTERPRISE');
  return getEnv('STRIPE_PRICE_PRO');
}

function billingAppBaseUrl() {
  return (
    String(process.env.BILLING_APP_BASE_URL || process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || '').trim() ||
    'http://localhost:5173'
  );
}

export class StripeProvider extends PaymentProvider {
  async getCustomer(tenant) {
    const stripe = stripeClient();
    const id = tenant?.billing_customer_id;
    if (!id || tenant?.billing_provider !== 'stripe') return null;
    try {
      const c = await stripe.customers.retrieve(id);
      if (c.deleted) return null;
      return { id: c.id };
    } catch {
      return null;
    }
  }

  async createCustomer(tenant) {
    const stripe = stripeClient();
    const created = await stripe.customers.create({
      name: tenant?.name ? String(tenant.name).slice(0, 256) : undefined,
      metadata: { tenantId: String(tenant.id) },
    });
    return { id: created.id };
  }

  async createCheckoutSession(tenant, plan) {
    const stripe = stripeClient();
    const priceId = priceIdForPlan(plan);
    const base = billingAppBaseUrl().replace(/\/$/, '');

    let customerId = tenant.billing_provider === 'stripe' ? tenant.billing_customer_id : null;
    if (!customerId) {
      const created = await this.createCustomer(tenant);
      customerId = created.id;
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${base}/?billing=success`,
      cancel_url: `${base}/?billing=cancelled`,
      client_reference_id: String(tenant.id),
      metadata: {
        tenantId: String(tenant.id),
        plan: normalizePlanKey(plan),
      },
      subscription_data: {
        metadata: {
          tenantId: String(tenant.id),
          plan: normalizePlanKey(plan),
        },
      },
    });

    if (!session.url) {
      throw new Error('Stripe não retornou URL de checkout');
    }

    return {
      url: session.url,
      customerId,
      subscriptionId: null,
    };
  }

  async parseWebhook(rawBody, headers) {
    const stripe = stripeClient();
    const secret = getEnv('STRIPE_WEBHOOK_SECRET');
    const sig = headers['stripe-signature'];
    if (!sig || Array.isArray(sig)) {
      throw new Error('Cabeçalho stripe-signature ausente');
    }

    const event = stripe.webhooks.constructEvent(rawBody, sig, secret);
    const items = await stripeEventToWebhookItems(event);
    let serializable = event;
    try {
      serializable = JSON.parse(JSON.stringify(event));
    } catch {
      /* keep reference */
    }

    return {
      providerEventId: event.id,
      payload: serializable,
      items,
      envelopeType: event.type,
    };
  }

  async cancelExternalSubscription(subscriptionId) {
    const stripe = stripeClient();
    await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
  }
}
