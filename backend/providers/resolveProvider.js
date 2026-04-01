/**
 * Resolução única do provider de canal (multi-tenant / multi-provider).
 * Sem padrão fixo: retorna null se não houver provider explícito (o caller deve validar).
 *
 * @param {object} channel - linha `channels` ou objeto equivalente
 * @returns {string | null} identificador normalizado em minúsculas
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
  return null;
}
