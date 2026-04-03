/**
 * WAHA Core (FREE): sessão única. WAHA PLUS: múltiplas sessões.
 *
 * WAHA_MULTI_SESSION=true  → nome estável `${tenantId}_${channelId}`
 * ausente ou outro valor   → FREE (sessão fixa do Core)
 */

export const WAHA_CORE_DEFAULT_SESSION = 'default';

/**
 * @param {{ tenantId?: string | null; channelId?: string | null }} params
 * @returns {string}
 */
export function resolveWahaSessionName({ tenantId, channelId }) {
  const isWahaFree = process.env.WAHA_MULTI_SESSION !== 'true';

  if (isWahaFree) {
    return WAHA_CORE_DEFAULT_SESSION;
  }

  const tid = tenantId != null ? String(tenantId).trim() : '';
  const cid = channelId != null ? String(channelId).trim() : '';
  if (!tid || !cid) {
    throw new Error('WAHA PLUS: tenantId e channelId são obrigatórios para o nome da sessão');
  }

  return `${tid}_${cid}`;
}
