/**
 * POST /api/evolution/webhook — entrada unificada de eventos Evolution (sem JWT).
 * Configure na Evolution: WEBHOOK_GLOBAL_URL ou webhook por instância apontando para esta URL.
 */

import * as evolutionWebhookController from './evolutionWebhook.controller.js';
import * as ingest from '../services/evolutionWebhookIngest.service.js';

export async function handleEvolutionIngressWebhook(req, res) {
  try {
    const body = req.body;
    if (!body || Object.keys(body).length === 0) {
      return res.status(200).json({ status: 'ignored_empty' });
    }

    const event = body.event || body.type;
    console.log('[EVOLUTION] webhook ingress event=%s', event);

    if (event === 'connection.update') {
      await ingest.applyConnectionUpdateFromPayload(body);
      return res.status(200).json({ received: true });
    }

    if (event === 'messages.upsert') {
      return evolutionWebhookController.handleEvolutionWhatsApp(req, res);
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('[EVOLUTION] webhook ingress error:', err.message);
    return res.status(200).json({ status: 'error_handled' });
  }
}
