import { priority } from '../../services/providerManager.js';
import { evolutionSessionAdapter } from './evolution.adapter.js';
import { wahaSessionAdapter } from './waha.adapter.js';

const adapters = {
  waha: wahaSessionAdapter,
  evolution: evolutionSessionAdapter,
};

export function getAdapter(provider) {
  const key = String(provider || '').toLowerCase().trim();
  const adapter = adapters[key];
  if (!adapter) {
    throw new Error(`Adapter de sessão não suportado: ${provider}`);
  }
  return adapter;
}

export function getProviderFallbackOrder(primaryProvider) {
  const p = String(primaryProvider || '').toLowerCase().trim();
  const base = Array.isArray(priority) && priority.length > 0 ? priority : Object.keys(adapters);
  if (!p) return base.filter((x) => adapters[x]);
  return [p, ...base.filter((x) => x !== p && adapters[x])];
}
