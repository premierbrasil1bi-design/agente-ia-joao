import { WahaProvider } from './waha.provider.js';
import { EvolutionProvider } from './evolution.provider.js';
import { ZapiProvider } from './zapi.provider.js';
import { resolveProvider } from './resolveProvider.js';
import { mergeProviderConfigForConnect } from './channelProviderConfig.js';

export { resolveProvider } from './resolveProvider.js';
export { mergeProviderConfigForConnect } from './channelProviderConfig.js';

/**
 * Instancia o adapter do provider com config explícita (uso interno / testes).
 * @param {string} provider
 * @param {object} config
 */
export function getProvider(provider, config = {}) {
  const key = String(provider || '').toLowerCase().trim();
  switch (key) {
    case 'waha':
      return new WahaProvider(config);
    case 'evolution':
      return new EvolutionProvider(config);
    case 'zapi':
      return new ZapiProvider(config);
    case 'official':
    case 'whatsapp_oficial':
      return new ZapiProvider(config);
    default:
      throw new Error(`Provider não suportado: ${provider}`);
  }
}

/**
 * Resolve provider + config a partir do canal (fluxo principal connect / QR / status).
 * @param {object} channel
 */
export function getProviderForChannel(channel) {
  const key = resolveProvider(channel);
  if (key == null || key === '') {
    throw new Error('Provider não definido no canal. Defina provider ou provider_config.type.');
  }
  const merged = mergeProviderConfigForConnect(channel);
  return getProvider(key, merged);
}
