/**
 * Processamento de eventos Evolution (connection.update, etc.) — usado por
 * POST /webhooks/evolution e POST /api/evolution/webhook.
 */

import * as channelsRepository from '../repositories/channelsRepository.js';
import { dualStatusFromEvolutionRaw } from '../utils/mapConnectionLifecycle.js';
import { transitionEvolutionChannelConnection } from './channelEvolutionState.service.js';

/**
 * @param {object} body — payload JSON da Evolution
 * @returns {Promise<boolean>} true se evento foi tratado (ou ignorado de propósito)
 */
export async function applyConnectionUpdateFromPayload(body) {
  const event = body?.event || body?.type || body?.action;
  if (event !== 'connection.update') return false;

  const instance =
    body.instance ?? body.data?.instance ?? body.instanceName ?? body?.data?.instanceName;
  const rawState = body.data?.state ?? body.state ?? body.data?.status;

  if (!instance || String(instance).trim() === '') {
    console.warn('[EVOLUTION] connection.update sem instance');
    return true;
  }

  const inst = String(instance).trim();
  const channel = await channelsRepository.findEvolutionChannelByExternalId(inst);

  if (!channel) {
    console.log('[EVOLUTION] connection.update instance=%s sem canal Evolution vinculado', inst);
    return true;
  }
  const { connection_status } = dualStatusFromEvolutionRaw(rawState);

  await transitionEvolutionChannelConnection({
    channelId: channel.id,
    tenantId: channel.tenant_id,
    channelRow: channel,
    nextConnectionStatus: connection_status,
    evolutionRaw: rawState,
    reason: `webhook: connection.update raw=${String(rawState)}`,
    source: 'webhook',
    trustRemoteState: true,
  });

  return true;
}
