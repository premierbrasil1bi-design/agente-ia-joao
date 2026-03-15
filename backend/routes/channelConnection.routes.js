/**
 * Rotas de conexão de canais WhatsApp (Evolution API).
 * POST /:id/connect, GET /:id/qrcode, GET /:id/status, POST /:id/disconnect
 * Middlewares: agentAuth, requireTenant (aplicados no server.js ao montar em /channels).
 */

import { Router } from 'express';
import {
  connectChannel,
  getQrCode,
  getStatus,
  disconnectChannel,
} from '../controllers/channelConnection.controller.js';

const router = Router();

router.post('/:id/connect', connectChannel);
router.get('/:id/qrcode', getQrCode);
router.get('/:id/status', getStatus);
router.post('/:id/disconnect', disconnectChannel);

export default router;
