/**
 * Regras de segurança para troca de provider em canais existentes (lifecycle + billing).
 */

const LIVE_CONNECTION_STATUSES = new Set(['connected', 'working', 'open', 'online']);

/**
 * Canal em estado “vivo” no WhatsApp: não permitir troca silenciosa de provider.
 * @param {object | null | undefined} channel — linha `channels`
 * @returns {boolean}
 */
export function isChannelConnectedBlockingProviderChange(channel) {
  if (!channel || typeof channel !== 'object') return false;
  const cs = String(channel.connection_status || '').toLowerCase().trim();
  if (LIVE_CONNECTION_STATUSES.has(cs)) return true;
  const legacy = String(channel.status || '').toLowerCase().trim();
  if (legacy === 'active' || legacy === 'connected') return true;
  return false;
}

export class ConnectedChannelProviderChangeError extends Error {
  constructor() {
    super('Não é possível trocar o provider de um canal conectado');
    this.name = 'ConnectedChannelProviderChangeError';
    this.code = 'CHANNEL_PROVIDER_CHANGE_BLOCKED';
    this.reason = 'connected_channel_provider_change_blocked';
    this.httpStatus = 409;
  }
}
