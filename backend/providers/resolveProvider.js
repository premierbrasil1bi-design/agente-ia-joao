/**
 * Resolução única do provider de canal (multi-tenant / multi-provider).
 * @param {object} channel - linha `channels` ou objeto equivalente
 * @returns {string} identificador normalizado em minúsculas (ex.: 'waha', 'evolution', 'zapi')
 */
export function resolveProvider(channel) {
  const fromRow = channel?.provider;
  if (fromRow != null && String(fromRow).trim() !== '') {
    return String(fromRow).trim().toLowerCase();
  }
  const t = channel?.provider_config?.type;
  if (t != null && String(t).trim() !== '') {
    return String(t).trim().toLowerCase();
  }
  return 'waha';
}
