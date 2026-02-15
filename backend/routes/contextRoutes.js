/**
 * Rotas de contexto – canal ativo, prompt em uso.
 * GET /api/context – canal do middleware. Nunca retorna 500: em erro retorna contexto mínimo (200).
 */

import { Router } from 'express';
import * as contextService from '../services/contextService.js';

const router = Router();

function minimalContext(req) {
  const ch = (req.context?.channel || 'WEB').toString().toUpperCase();
  return {
    client_id: req.context?.client_id ?? null,
    agent_id: req.context?.agent_id ?? null,
    channel: ch,
    prompt_id: null,
    canal_nome: ch,
  };
}

/**
 * GET /context – client_id e agent_id do middleware; canal do middleware.
 * Header: x-channel-active.
 */
router.get('/context', async (req, res) => {
  try {
    const clientId = req.context?.client_id ?? null;
    const agentId = req.context?.agent_id ?? null;
    const channel = req.context?.channel ?? 'web';

    const data = await contextService.getContext(clientId, agentId, channel);

    res.set('x-channel-active', data.channel);
    res.status(200).json(data);
  } catch (err) {
    console.error('[context] GET /context:', err.message);
    const data = minimalContext(req);
    res.set('x-channel-active', data.channel);
    res.status(200).json(data);
  }
});

export default router;
