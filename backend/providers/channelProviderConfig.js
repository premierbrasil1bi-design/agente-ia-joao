/**
 * Config mesclada para instanciar providers (instance/session alinhados ao canal).
 */
import { resolveProvider } from './resolveProvider.js';
import { resolveSessionName } from '../utils/resolveSessionName.js';

/**
 * @param {object} channel
 * @param {{ correlationId?: string|null }} [extra]
 */
export function mergeProviderConfigForConnect(channel, extra = {}) {
  const pc =
    channel?.provider_config && typeof channel.provider_config === 'object'
      ? { ...channel.provider_config }
      : {};
  const prov = resolveProvider(channel);

  const corr =
    extra.correlationId != null && String(extra.correlationId).trim() !== ''
      ? String(extra.correlationId).trim().slice(0, 128)
      : undefined;

  if (prov === 'waha') {
    const stable = resolveSessionName(channel);
    return {
      ...pc,
      instance: stable,
      instanceName: stable,
      session: stable,
      channelId: channel?.id ?? null,
      tenantId: channel?.tenant_id ?? null,
      ...(corr ? { correlationId: corr } : {}),
    };
  }

  const ext =
    channel.external_id != null && String(channel.external_id).trim() !== ''
      ? String(channel.external_id).trim()
      : null;
  const inst =
    channel.instance != null && String(channel.instance).trim() !== ''
      ? String(channel.instance).trim()
      : null;
  const name = pc.instance || pc.instanceName || ext || inst || 'default';
  return {
    ...pc,
    instance: name,
    instanceName: name,
    session: name,
    channelId: channel?.id ?? null,
    tenantId: channel?.tenant_id ?? null,
    ...(corr ? { correlationId: corr } : {}),
  };
}
