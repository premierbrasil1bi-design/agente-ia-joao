import { StripeProvider } from './StripeProvider.js';
import { AsaasProvider } from './AsaasProvider.js';

/** @type {import('./StripeProvider.js').StripeProvider | import('./AsaasProvider.js').AsaasProvider | null} */
let singleton = null;

/**
 * Provedor configurado por PAYMENT_PROVIDER=stripe|asaas (padrão: stripe).
 * @returns {import('./PaymentProvider.js').PaymentProvider}
 */
export function getPaymentProvider() {
  if (singleton) return singleton;
  const name = String(process.env.PAYMENT_PROVIDER || 'stripe').toLowerCase().trim();
  if (name === 'asaas') {
    singleton = new AsaasProvider();
  } else {
    singleton = new StripeProvider();
  }
  return singleton;
}

/** Para testes ou hot-reload. */
export function resetPaymentProviderForTests() {
  singleton = null;
}
