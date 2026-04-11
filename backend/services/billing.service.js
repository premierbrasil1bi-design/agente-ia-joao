import { getPlanDefaults, normalizePlanKey } from '../config/plans.config.js';
import { pool } from '../db/pool.js';
import {
  applyTenantBillingPastDueTx,
  applyTenantPlanFromPaymentTx,
  applyTenantSubscriptionCanceledTx,
  clearTenantBillingSubscription,
  getTenantById,
  lockTenantRowForUpdate,
  updateTenantBillingRefs,
} from '../repositories/tenant.repository.js';
import {
  getBillingEventById,
  insertBillingEventPending,
  resetBillingEventToPending,
  selectBillingEventByIdForUpdate,
  selectBillingEventForUpdate,
  updateBillingEventOutcome,
} from '../repositories/billingEvents.repository.js';
import { log } from '../utils/logger.js';
import { invalidateTenantLimitsCache } from './tenantLimits.service.js';
import { getPaymentProvider } from './paymentProviders/paymentProviderFactory.js';
import { stripeEventToWebhookItems } from './paymentProviders/stripeWebhookItems.js';
import { asaasBodyToWebhookEnvelope } from './paymentProviders/asaasWebhookItems.js';
import {
  assertPaidForActivation,
  BillingValidationError,
} from './billingPaymentValidation.service.js';

const PLAN_RANK = { free: 0, pro: 1, enterprise: 2 };

function rankOf(planKey) {
  const k = normalizePlanKey(planKey);
  return PLAN_RANK[k] ?? 0;
}

export function billingProviderName() {
  return String(process.env.PAYMENT_PROVIDER || 'stripe').toLowerCase().trim() === 'asaas' ? 'asaas' : 'stripe';
}

function billingCancelPolicy() {
  return String(process.env.BILLING_CANCEL_POLICY || 'downgrade').toLowerCase().trim() === 'suspend'
    ? 'suspend'
    : 'downgrade';
}

function assertCheckoutPlan(raw) {
  const k = String(raw || '').toLowerCase().trim();
  if (k !== 'pro' && k !== 'enterprise') {
    const e = new Error('Informe plan "pro" ou "enterprise".');
    e.statusCode = 400;
    throw e;
  }
  return k;
}

function limitsFromPlan(planKey) {
  const d = getPlanDefaults(planKey);
  const maxAgents =
    d.maxAgents != null && d.maxAgents !== '' && Number.isFinite(Number(d.maxAgents))
      ? Number(d.maxAgents)
      : null;
  const maxMessages =
    d.maxMessages != null && d.maxMessages !== '' && Number.isFinite(Number(d.maxMessages))
      ? Number(d.maxMessages)
      : null;
  return { max_agents: maxAgents, max_messages: maxMessages };
}

function freePlanLimitsForCancel() {
  return limitsFromPlan('free');
}

/** @param {object} row — linha billing_events */
async function buildEnvelopeForReprocess(row) {
  if (row.provider === 'stripe') {
    const Stripe = (await import('stripe')).default;
    const key = String(process.env.STRIPE_SECRET_KEY || '').trim();
    if (!key) throw new Error('STRIPE_SECRET_KEY ausente');
    const stripe = new Stripe(key);
    const event = await stripe.events.retrieve(row.provider_event_id);
    const items = await stripeEventToWebhookItems(event);
    let serializable = event;
    try {
      serializable = JSON.parse(JSON.stringify(event));
    } catch {
      /* keep */
    }
    return {
      providerEventId: row.provider_event_id,
      payload: serializable,
      items,
      envelopeType: event.type,
    };
  }

  const body = row.payload && typeof row.payload === 'object' ? row.payload : {};
  const { items } = await asaasBodyToWebhookEnvelope(body);
  return {
    providerEventId: row.provider_event_id,
    payload: body,
    items,
    envelopeType: row.type,
  };
}

/**
 * @param {import('pg').PoolClient} client
 * @param {'stripe'|'asaas'} providerName
 * @param {import('./paymentProviders/PaymentProvider.js').BillingWebhookItem} item
 * @param {Set<string>} tenantsTouched
 */
async function processWebhookItem(client, providerName, item, tenantsTouched) {
  if (!item.tenantId) return;

  await lockTenantRowForUpdate(client, item.tenantId);
  tenantsTouched.add(item.tenantId);

  if (item.type === 'payment_success' || item.type === 'subscription_active') {
    const planKey = normalizePlanKey(item.plan);
    if (planKey !== 'pro' && planKey !== 'enterprise') {
      throw new BillingValidationError('Plano inválido para ativação por billing');
    }
    const paid = await assertPaidForActivation(providerName, item);
    const { max_agents, max_messages } = limitsFromPlan(planKey);
    const row = await applyTenantPlanFromPaymentTx(client, item.tenantId, planKey, {
      billing_provider: providerName,
      billing_customer_id: paid.customerId ?? item.customerId ?? null,
      billing_subscription_id: paid.subscriptionId ?? item.subscriptionId ?? null,
      max_agents,
      max_messages,
    });
    if (!row) throw new Error('Tenant não encontrado após lock');

    log.info({
      event: 'TENANT_PLAN_UPDATED',
      context: 'billing',
      tenantId: item.tenantId,
      provider: providerName,
      metadata: {
        plan: planKey,
        max_agents,
        max_messages,
        billing_provider: providerName,
        eventItemType: item.type,
      },
    });
    log.info({
      event: 'BILLING_PAYMENT_SUCCESS',
      context: 'billing',
      tenantId: item.tenantId,
      provider: providerName,
      metadata: { plan: planKey, externalEventId: item.externalEventId ?? null },
    });
    return;
  }

  if (item.type === 'payment_failed') {
    await applyTenantBillingPastDueTx(client, item.tenantId);
    log.warn({
      event: 'BILLING_PAYMENT_FAILED',
      context: 'billing',
      tenantId: item.tenantId,
      provider: providerName,
      metadata: { reason: 'past_due', externalEventId: item.externalEventId ?? null },
    });
    return;
  }

  if (item.type === 'subscription_canceled') {
    const policy = billingCancelPolicy();
    const free = freePlanLimitsForCancel();
    await applyTenantSubscriptionCanceledTx(client, item.tenantId, policy, free);
    log.info({
      event: 'BILLING_SUBSCRIPTION_CANCELED_APPLIED',
      context: 'billing',
      tenantId: item.tenantId,
      provider: providerName,
      metadata: { policy, externalEventId: item.externalEventId ?? null },
    });
    return;
  }
}

/**
 * @param {{ providerName: 'stripe'|'asaas', envelope: import('./paymentProviders/PaymentProvider.js').WebhookParseResult, mode?: 'live'|'reprocess', internalEventId?: string }} opts
 */
async function runBillingEnvelope(opts) {
  const { providerName, envelope, mode = 'live', internalEventId } = opts;
  const client = await pool.connect();
  const lockKey = `billing:${providerName}:${envelope.providerEventId}`;
  /** @type {string|null} */
  let eventRowId = null;
  let txnOpen = false;

  try {
    await client.query('BEGIN');
    txnOpen = true;
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1::text))`, [lockKey]);

    if (mode === 'reprocess' && internalEventId) {
      const lockedRow = await selectBillingEventByIdForUpdate(client, internalEventId);
      if (!lockedRow || lockedRow.status !== 'failed') {
        await client.query('ROLLBACK');
        txnOpen = false;
        const e = new Error('Reprocessamento inválido: evento inexistente ou status diferente de failed');
        e.httpStatus = 400;
        throw e;
      }
      await resetBillingEventToPending(client, internalEventId);
      eventRowId = internalEventId;
      await client.query(
        `UPDATE billing_events SET payload = $2::jsonb, tenant_id = COALESCE($3::uuid, tenant_id), type = $4 WHERE id = $1::uuid`,
        [
          eventRowId,
          JSON.stringify(envelope.payload),
          envelope.items[0]?.tenantId ?? lockedRow.tenant_id ?? null,
          envelope.envelopeType,
        ],
      );
    } else {
      const ex = await selectBillingEventForUpdate(client, providerName, envelope.providerEventId);
      if (ex) {
        if (ex.status === 'processed' || ex.status === 'ignored') {
          await client.query('COMMIT');
          txnOpen = false;
          log.info({
            event: 'BILLING_EVENT_DUPLICATE',
            context: 'billing',
            tenantId: ex.tenant_id ?? envelope.items[0]?.tenantId ?? null,
            provider: providerName,
            metadata: {
              eventId: envelope.providerEventId,
              type: envelope.envelopeType,
              dbStatus: ex.status,
            },
          });
          return { duplicate: true };
        }
        if (ex.status === 'failed') {
          await resetBillingEventToPending(client, ex.id);
        }
        eventRowId = ex.id;
        await client.query(
          `UPDATE billing_events SET payload = $2::jsonb, tenant_id = COALESCE($3::uuid, tenant_id), type = $4 WHERE id = $1::uuid`,
          [
            eventRowId,
            JSON.stringify(envelope.payload),
            envelope.items[0]?.tenantId ?? ex.tenant_id ?? null,
            envelope.envelopeType,
          ],
        );
      } else {
        const ins = await insertBillingEventPending(client, {
          provider_event_id: envelope.providerEventId,
          provider: providerName,
          tenant_id: envelope.items[0]?.tenantId ?? null,
          type: envelope.envelopeType,
          payload: envelope.payload,
        });
        eventRowId = ins.id;
      }
    }

    const tenantsTouched = new Set();
    await client.query('SAVEPOINT billing_activate');

    try {
      if (!envelope.items.length) {
        await updateBillingEventOutcome(client, eventRowId, { status: 'ignored' });
      } else {
        for (const item of envelope.items) {
          await processWebhookItem(client, providerName, item, tenantsTouched);
        }
        await updateBillingEventOutcome(client, eventRowId, { status: 'processed' });
      }
      await client.query('RELEASE SAVEPOINT billing_activate');
      await client.query('COMMIT');
      txnOpen = false;

      log.info({
        event: 'BILLING_EVENT_PROCESSED',
        context: 'billing',
        tenantId: envelope.items[0]?.tenantId ?? null,
        provider: providerName,
        metadata: {
          eventId: envelope.providerEventId,
          type: envelope.envelopeType,
          outcome: envelope.items.length ? 'processed' : 'ignored',
        },
      });

      for (const tid of tenantsTouched) invalidateTenantLimitsCache(tid);
      return { ok: true };
    } catch (procErr) {
      await client.query('ROLLBACK TO SAVEPOINT billing_activate');

      if (procErr instanceof BillingValidationError) {
        await updateBillingEventOutcome(client, eventRowId, { status: 'ignored' });
        await client.query('COMMIT');
        txnOpen = false;
        log.info({
          event: 'BILLING_EVENT_PROCESSED',
          context: 'billing',
          tenantId: envelope.items[0]?.tenantId ?? null,
          provider: providerName,
          metadata: {
            eventId: envelope.providerEventId,
            type: envelope.envelopeType,
            outcome: 'ignored',
            reason: procErr.message,
          },
        });
        for (const tid of tenantsTouched) invalidateTenantLimitsCache(tid);
        return { ignored: true };
      }

      await updateBillingEventOutcome(client, eventRowId, {
        status: 'failed',
        error_message: procErr?.message || String(procErr),
      });
      await client.query('COMMIT');
      txnOpen = false;

      log.error({
        event: 'BILLING_EVENT_FAILED',
        context: 'billing',
        tenantId: envelope.items[0]?.tenantId ?? null,
        provider: providerName,
        metadata: { eventId: envelope.providerEventId, type: envelope.envelopeType },
        error: procErr?.message || String(procErr),
        stack: procErr?.stack,
      });

      const wrap = new Error(procErr?.message || 'Falha ao processar webhook de billing');
      wrap.httpStatus = 500;
      throw wrap;
    }
  } catch (e) {
    if (txnOpen) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
    }
    throw e;
  } finally {
    client.release();
  }
}

/**
 * @param {string} tenantId
 * @param {string} planRaw
 * @returns {Promise<{ url: string }>}
 */
export async function createCheckout(tenantId, planRaw) {
  const target = assertCheckoutPlan(planRaw);
  const tenant = await getTenantById(tenantId);
  if (!tenant) {
    const e = new Error('Tenant não encontrado');
    e.statusCode = 404;
    throw e;
  }
  const current = normalizePlanKey(tenant.plan);
  if (rankOf(target) <= rankOf(current)) {
    const e = new Error('Upgrade não disponível para o plano atual.');
    e.statusCode = 400;
    throw e;
  }

  const provider = getPaymentProvider();
  const providerName = billingProviderName();
  const session = await provider.createCheckoutSession(tenant, target);

  await updateTenantBillingRefs(tenantId, {
    billing_provider: providerName,
    billing_customer_id: session.customerId ?? null,
    billing_subscription_id: session.subscriptionId ?? null,
  });

  log.info({
    event: 'BILLING_CHECKOUT_CREATED',
    context: 'billing',
    tenantId,
    metadata: { plan: target, provider: providerName },
  });

  return { url: session.url };
}

/**
 * Ativa plano (transação + lock por tenant). Mantido para compatibilidade; webhook usa o mesmo núcleo com SAVEPOINT.
 * @param {string} tenantId
 * @param {string} planRaw
 * @param {{ billing_provider?: string, customerId?: string|null, subscriptionId?: string|null }} [ext]
 */
export async function activatePlan(tenantId, planRaw, ext = {}) {
  const planKey = normalizePlanKey(planRaw);
  if (planKey !== 'pro' && planKey !== 'enterprise') {
    log.warn({
      event: 'BILLING_PAYMENT_FAILED',
      context: 'billing',
      tenantId,
      metadata: { reason: 'invalid_plan_key', plan: planRaw },
    });
    return null;
  }

  const billing_provider = ext.billing_provider || billingProviderName();
  const { max_agents, max_messages } = limitsFromPlan(planKey);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1::text))`, [`tenant-billing:${tenantId}`]);
    const locked = await lockTenantRowForUpdate(client, tenantId);
    if (!locked) {
      await client.query('ROLLBACK');
      log.error({
        event: 'BILLING_PAYMENT_FAILED',
        context: 'billing',
        tenantId,
        metadata: { reason: 'tenant_not_found_after_payment', plan: planKey },
      });
      return null;
    }

    const row = await applyTenantPlanFromPaymentTx(client, tenantId, planKey, {
      billing_provider,
      billing_customer_id: ext.customerId ?? null,
      billing_subscription_id: ext.subscriptionId ?? null,
      max_agents,
      max_messages,
    });
    await client.query('COMMIT');
    invalidateTenantLimitsCache(tenantId);

    log.info({
      event: 'TENANT_PLAN_UPDATED',
      context: 'billing',
      tenantId,
      metadata: {
        plan: planKey,
        max_agents,
        max_messages,
        billing_provider,
        source: 'activatePlan',
      },
    });

    return row;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * @param {Buffer} rawBody
 * @param {import('http').IncomingHttpHeaders} headers
 */
export async function handleWebhook(rawBody, headers) {
  const provider = getPaymentProvider();
  const providerName = billingProviderName();
  let envelope;
  try {
    envelope = await provider.parseWebhook(rawBody, headers);
  } catch (e) {
    e.httpStatus = 400;
    throw e;
  }

  log.info({
    event: 'BILLING_EVENT_RECEIVED',
    context: 'billing',
    tenantId: envelope.items[0]?.tenantId ?? null,
    provider: providerName,
    metadata: { eventId: envelope.providerEventId, type: envelope.envelopeType },
  });

  return runBillingEnvelope({ providerName, envelope, mode: 'live' });
}

/**
 * Reprocessa um registro interno de billing_events (UUID) com status failed, sem duplicar efeito graças à idempotência no tenant.
 * @param {string} eventId — billing_events.id
 */
export async function reprocessBillingEvent(eventId) {
  const row = await getBillingEventById(eventId);
  if (!row) {
    const e = new Error('Evento não encontrado');
    e.statusCode = 404;
    throw e;
  }
  if (row.status !== 'failed') {
    const e = new Error('Somente eventos com status failed podem ser reprocessados');
    e.statusCode = 400;
    throw e;
  }

  const envelope = await buildEnvelopeForReprocess(row);
  log.info({
    event: 'BILLING_EVENT_RECEIVED',
    context: 'billing',
    tenantId: envelope.items[0]?.tenantId ?? row.tenant_id ?? null,
    provider: row.provider,
    metadata: { eventId: envelope.providerEventId, type: envelope.envelopeType, reprocess: true },
  });

  return runBillingEnvelope({
    providerName: row.provider,
    envelope,
    mode: 'reprocess',
    internalEventId: row.id,
  });
}

/**
 * @param {string} tenantId
 */
export async function cancelSubscription(tenantId) {
  const tenant = await getTenantById(tenantId);
  if (!tenant?.billing_subscription_id) {
    return { ok: true, skipped: true };
  }
  const provider = getPaymentProvider();
  await provider.cancelExternalSubscription(tenant.billing_subscription_id);
  await clearTenantBillingSubscription(tenantId);
  invalidateTenantLimitsCache(tenantId);
  return { ok: true };
}
