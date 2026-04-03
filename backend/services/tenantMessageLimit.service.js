/**
 * Limites de mensagens outbound por tenant (plano / billing).
 * max_messages null ou <= 0 = sem limite (compatível com legado).
 */

export const BILLING_CYCLE_DAYS = 30;

/**
 * Checagem soft (ex.: leituras em memória). O envio outbound usa tryConsumeTenantMessageQuota no repository.
 *
 * @param {object | null | undefined} tenant - linha de tenants (após refresh de ciclo, se aplicável)
 * @throws {Error} code MESSAGE_LIMIT_EXCEEDED, httpStatus 429, quando uso >= limite
 */
export function checkTenantMessageLimit(tenant) {
  if (!tenant) return;
  const max = Number(tenant.max_messages);
  if (!Number.isFinite(max) || max <= 0) return;

  const used = Math.max(0, Number(tenant.messages_used_current_period ?? 0));
  if (used >= max) {
    const e = new Error('Limite de mensagens do período excedido para este tenant.');
    e.code = 'MESSAGE_LIMIT_EXCEEDED';
    e.httpStatus = 429;
    e.details = {
      max_messages: max,
      messages_used_current_period: used,
    };
    throw e;
  }
}
