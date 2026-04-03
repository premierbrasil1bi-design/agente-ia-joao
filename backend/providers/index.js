import { getProvider as getProviderByName, getProviderForChannel as getProviderFromChannel } from './provider.factory.js';
import { mergeProviderConfigForConnect, resolveProvider } from './provider.factory.js';

export function getProvider(providerName, config = {}) {
  return getProviderByName(providerName, config);
}

export function getProviderForChannel(channel) {
  return getProviderFromChannel(channel);
}

export function buildProviderContext(channel) {
  const providerName = resolveProvider(channel);
  const config = mergeProviderConfigForConnect(channel);
  return { providerName, config };
}

