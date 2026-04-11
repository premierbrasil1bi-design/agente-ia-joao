import { WahaProvider } from './WahaProvider.js';
import { EvolutionProvider } from './EvolutionProvider.js';

export function getProvider(type, channel, opts = {}) {
  const key = String(type || '').toLowerCase().trim();
  switch (key) {
    case 'waha':
      return new WahaProvider(channel, opts);
    case 'evolution':
      return new EvolutionProvider(channel, opts);
    default:
      throw new Error(`Provider não suportado: ${type}`);
  }
}
