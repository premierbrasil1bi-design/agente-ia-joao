import { getProvider as getProviderByName, getProviderForChannel as getProviderFromChannel } from './provider.factory.js';
import { mergeProviderConfigForConnect, resolveProvider } from './provider.factory.js';

export function getProvider(providerName, config = {}) {
  return getProviderByName(providerName, config);
}

export function getProviderForChannel(channel, opts = {}) {
  return getProviderFromChannel(channel, opts);
}

export function buildProviderContext(channel, opts = {}) {
  const providerName = resolveProvider(channel);
  const config = mergeProviderConfigForConnect(channel, opts);
  return { providerName, config };
}

