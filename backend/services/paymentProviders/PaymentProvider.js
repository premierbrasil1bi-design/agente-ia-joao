/**
 * Contrato dos provedores de pagamento (Stripe, Asaas).
 * O plano só muda após webhook validado — nunca confiar no frontend.
 */

/**
 * @typedef {object} TenantRow
 * @property {string} id
 * @property {string} [name]
 * @property {string} [plan]
 * @property {string|null} [billing_provider]
 * @property {string|null} [billing_customer_id]
 * @property {string|null} [billing_subscription_id]
 */

/**
 * @typedef {object} CheckoutSessionResult
 * @property {string} url — URL para redirecionar o usuário
 * @property {string|null} [customerId]
 * @property {string|null} [subscriptionId]
 */

/**
 * @typedef {object} BillingWebhookItem
 * @property {'payment_success'|'subscription_active'|'payment_failed'|'subscription_canceled'} type
 * @property {string} tenantId
 * @property {string} plan
 * @property {string|null} [customerId]
 * @property {string|null} [subscriptionId]
 * @property {string} [externalEventId]
 * @property {string} [stripeSessionId]
 * @property {string} [stripeSubscriptionId]
 * @property {string} [asaasPaymentId]
 * @property {string} [asaasSubscriptionId]
 */

/**
 * @typedef {object} WebhookParseResult
 * @property {string} providerEventId
 * @property {object} payload
 * @property {BillingWebhookItem[]} items
 * @property {string} envelopeType
 */

export class PaymentProvider {
  /**
   * @param {TenantRow} tenant
   * @param {'pro'|'enterprise'} plan
   * @returns {Promise<CheckoutSessionResult>}
   */
  async createCheckoutSession(_tenant, _plan) {
    throw new Error('createCheckoutSession não implementado');
  }

  /**
   * Valida assinatura / token e devolve envelope idempotente + itens.
   * @param {Buffer} rawBody
   * @param {import('http').IncomingHttpHeaders} headers
   * @returns {Promise<WebhookParseResult>}
   */
  async parseWebhook(_rawBody, _headers) {
    throw new Error('parseWebhook não implementado');
  }

  /**
   * @param {TenantRow} tenant
   * @returns {Promise<{ id: string }|null>}
   */
  async getCustomer(_tenant) {
    throw new Error('getCustomer não implementado');
  }

  /**
   * @param {TenantRow} tenant
   * @returns {Promise<{ id: string }>}
   */
  async createCustomer(_tenant) {
    throw new Error('createCustomer não implementado');
  }

  /**
   * @param {string} subscriptionId
   * @returns {Promise<void>}
   */
  async cancelExternalSubscription(_subscriptionId) {
    throw new Error('cancelExternalSubscription não implementado');
  }
}
