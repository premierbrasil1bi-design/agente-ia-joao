/**
 * GET /api/evolution/instances
 * POST /api/evolution/instance
 * GET /api/evolution/qrcode/:instance
 */

import { Router } from 'express';
import { agentAuth } from '../middleware/agentAuth.js';
import { requireActiveTenant } from '../middleware/requireActiveTenant.js';
import * as evolutionGateway from '../controllers/evolutionGateway.controller.js';

const router = Router();

router.use(agentAuth);

router.get('/instances', requireActiveTenant, evolutionGateway.listInstances);
router.post('/instance', requireActiveTenant, evolutionGateway.createInstance);
router.get('/qrcode/:instance', requireActiveTenant, evolutionGateway.getQrCode);

export default router;
