/**
 * Invalidação leve após mudanças em canais (ex.: DELETE).
 * Clientes podem escutar `channels:invalidate` e refetch da lista.
 */
export function invalidateTenantChannels(tenantId) {
  if (!tenantId || !globalThis.io) return;
  try {
    globalThis.io.to(`tenant:${String(tenantId)}`).emit('channels:invalidate', { tenantId: String(tenantId) });
  } catch {
    /* ignore */
  }
}
