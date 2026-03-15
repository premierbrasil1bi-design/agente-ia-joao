/**
 * Rotas do Contexto do Agente (agent_contexts) – Client App.
 * GET /api/context?agent_id=UUID  |  POST /api/context (body: agent_id + campos)
 */

import express from 'express';
import { getContext, saveContext } from '../controllers/agentContext.controller.js';
import { agentAuth } from '../middleware/agentAuth.js';
import { requireTenant } from '../middleware/requireTenant.js';

const router = express.Router();

router.get('/', agentAuth, requireTenant, getContext);
router.post('/', agentAuth, requireTenant, saveContext);

export default router;
