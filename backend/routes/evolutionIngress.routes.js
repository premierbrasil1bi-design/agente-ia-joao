/**
 * Rotas públicas sob /api/evolution (sem agentAuth) — apenas webhook.
 */

import { Router } from 'express';
import * as evolutionIngressWebhook from '../controllers/evolutionIngressWebhook.controller.js';

const router = Router();

router.post('/webhook', evolutionIngressWebhook.handleEvolutionIngressWebhook);

export default router;
