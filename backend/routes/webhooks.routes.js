/**
 * Webhooks Evolution API.
 * POST /webhooks/evolution – recebe connection.update, messages.upsert, qrcode.update.
 * connection.update: dual-write em channels.status + connection_status.
 */

import { Router } from 'express';
import * as ingest from '../services/evolutionWebhookIngest.service.js';
import { logger } from '../utils/logger.js';

const router = Router();

router.post('/evolution', (req, res) => {
  res.status(200).json({ received: true });

  const body = req.body || {};
  const event = body.event || body.type || body.action;
  const instance = body.instance ?? body.data?.instance ?? body.instanceName;

  if (!event) return;

  if (event === 'connection.update') {
    ingest
      .applyConnectionUpdateFromPayload(body)
      .catch((err) => logger.apiError('webhook connection.update', instance, err.message));
  }

  if (event === 'messages.upsert' || event === 'qrcode.update') {
  }
});

export default router;
