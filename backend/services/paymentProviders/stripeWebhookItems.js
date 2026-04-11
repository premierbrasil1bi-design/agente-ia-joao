import Stripe from 'stripe';
import { normalizePlanKey } from '../../config/plans.config.js';

function getEnv(name, required = true) {
  const v = String(process.env[name] || '').trim();
  if (!v && required) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }
  return v || null;
}

function stripeClient() {
  return new Stripe(getEnv('STRIPE_SECRET_KEY'));
}

/**
 * Converte um Stripe Event já verificado em itens normalizados para o pipeline de billing.
 * @param {import('stripe').Stripe.Event} event
 */
export async function stripeEventToWebhookItems(event) {
  const stripe = stripeClient();
  /** @type {Array<{ type: string, tenantId: string, plan: string, customerId?: string|null, subscriptionId?: string|null, externalEventId?: string, stripeSessionId?: string, stripeSubscriptionId?: string }>} */
  const items = [];

  switch (event.type) {
    case 'checkout.session.completed': {
      const s = event.data.object;
      if (s.mode === 'subscription' && s.metadata?.tenantId && s.metadata?.plan) {
        items.push({
          type: 'payment_success',
          tenantId: String(s.metadata.tenantId),
          plan: normalizePlanKey(s.metadata.plan),
          customerId: typeof s.customer === 'string' ? s.customer : s.customer?.id ?? null,
          subscriptionId:
            typeof s.subscription === 'string' ? s.subscription : s.subscription?.id ?? null,
          externalEventId: event.id,
          stripeSessionId: s.id,
        });
      }
      break;
    }
    case 'customer.subscription.updated': {
      const sub = event.data.object;
      if (sub.status === 'active' && sub.metadata?.tenantId && sub.metadata?.plan) {
        items.push({
          type: 'subscription_active',
          tenantId: String(sub.metadata.tenantId),
          plan: normalizePlanKey(sub.metadata.plan),
          customerId: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null,
          subscriptionId: sub.id,
          externalEventId: event.id,
          stripeSubscriptionId: sub.id,
        });
      }
      break;
    }
    case 'invoice.payment_failed': {
      const inv = event.data.object;
      const subId = typeof inv.subscription === 'string' ? inv.subscription : inv.subscription?.id ?? null;
      if (subId) {
        const sub = await stripe.subscriptions.retrieve(subId);
        if (sub.metadata?.tenantId) {
          items.push({
            type: 'payment_failed',
            tenantId: String(sub.metadata.tenantId),
            plan: normalizePlanKey(sub.metadata.plan || 'free'),
            customerId: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null,
            subscriptionId: sub.id,
            externalEventId: event.id,
            stripeSubscriptionId: sub.id,
          });
        }
      }
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      if (sub.metadata?.tenantId) {
        items.push({
          type: 'subscription_canceled',
          tenantId: String(sub.metadata.tenantId),
          plan: normalizePlanKey(sub.metadata.plan || 'free'),
          customerId: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null,
          subscriptionId: sub.id,
          externalEventId: event.id,
          stripeSubscriptionId: sub.id,
        });
      }
      break;
    }
    default:
      break;
  }

  return items;
}
