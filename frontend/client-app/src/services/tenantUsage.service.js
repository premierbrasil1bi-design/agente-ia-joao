import { agentApi } from './agentApi.js';

/**
 * GET /api/tenant/usage — uso no ciclo (logs success), limite e restante.
 * @returns {Promise<{
 *   billing_cycle_start: string | null,
 *   max_messages: number | null,
 *   messages_used_success: number,
 *   messages_remaining: number | null,
 *   unlimited: boolean,
 *   plan: string | null
 * }>}
 */
export function getTenantUsage() {
  return agentApi.request('/api/tenant/usage');
}
