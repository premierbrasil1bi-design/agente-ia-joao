/**
 * Nome estável de sessão WAHA por canal — evita colisão entre tenants (multi-tenant).
 * Formato: {tenant_id}_{channel_id}
 *
 * @param {object} channel - precisa tenant_id e id (UUID)
 * @returns {string}
 */
export function resolveSessionName(channel) {
  if (!channel || typeof channel !== 'object') {
    throw new Error('Canal inválido para resolveSessionName');
  }
  const tid = channel.tenant_id != null ? String(channel.tenant_id).trim() : '';
  const cid = channel.id != null ? String(channel.id).trim() : '';
  if (!tid || !cid) {
    throw new Error('Canal sem tenant_id ou id — impossível definir sessão WAHA');
  }
  return `${tid}_${cid}`;
}
