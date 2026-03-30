/**
 * Config mesclada para instanciar providers (instance/session alinhados ao canal).
 */
export function mergeProviderConfigForConnect(channel) {
  const pc =
    channel?.provider_config && typeof channel.provider_config === 'object'
      ? { ...channel.provider_config }
      : {};
  const ext =
    channel.external_id != null && String(channel.external_id).trim() !== ''
      ? String(channel.external_id).trim()
      : null;
  const inst =
    channel.instance != null && String(channel.instance).trim() !== ''
      ? String(channel.instance).trim()
      : null;
  const name = pc.instance || pc.instanceName || ext || inst || 'default';
  return { ...pc, instance: name, instanceName: name, session: name };
}
