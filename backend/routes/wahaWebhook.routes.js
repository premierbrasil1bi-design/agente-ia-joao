import express from 'express';
import { handleWahaWebhook } from '../controllers/wahaWebhook.controller.js';

const router = express.Router();

// Rota pública (sem auth)
router.post('/webhook/waha', handleWahaWebhook);

export default router;

