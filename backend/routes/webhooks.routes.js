/**
 * Webhooks Evolution API.
 * POST /webhooks/evolution – recebe connection.update, messages.upsert, qrcode.update.
 * Para connection.update: atualiza channels.status (active | inactive no banco).
 */

import { Router } from 'express';
import * as channelsRepository from '../repositories/channelsRepository.js';
import * as channelRepo from '../repositories/channel.repository.js';
import { normalizeEvolutionState } from '../utils/evolutionState.js';
import { mapEvolutionStatus, toEvolutionStatusColumn } from '../utils/mapEvolutionStatus.js';
import { logger } from '../utils/logger.js';

const router = Router();

router.post('/evolution', (req, res) => {
  res.status(200).json({ received: true });

  const body = req.body || {};
  const event = body.event || body.type || body.action;
  const instance = body.instance ?? body.data?.instance ?? body.instanceName;

  if (!event) return;

  if (event === 'connection.update') {
    const rawState = body.data?.state ?? body.state ?? body.data?.status;
    const normalizedStatus = normalizeEvolutionState(rawState);
    const dbStatus = mapEvolutionStatus(rawState);
    console.log('[channels] status normalized:', rawState, '→', dbStatus);
    console.log('[channels] webhook evolution status:', rawState);
    if (!instance) return;

    channelsRepository
      .findByExternalId(instance)
      .then((channel) => {
        if (!channel) return;
        const previousStatus = channel.status ?? null;
        if (dbStatus !== previousStatus) {
          logger.statusChange(instance, channel.id, previousStatus, normalizedStatus);
        }
        return channelRepo.updateConnection(channel.id, channel.tenant_id, {
          status: dbStatus,
          evolution_status: toEvolutionStatusColumn(rawState),
          ...(dbStatus === 'active' ? { connected_at: new Date(), last_error: null } : {}),
        });
      })
      .catch((err) => logger.apiError('webhook connection.update', instance, err.message));
  }

  if (event === 'messages.upsert' || event === 'qrcode.update') {
  }
});

export default router;
