import { WahaProvider } from './waha.provider.js';
import { EvolutionProvider } from './evolution.provider.js';
import { ZapiProvider } from './zapi.provider.js';

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
