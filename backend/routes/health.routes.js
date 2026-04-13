import express from 'express';
import { getMessagingHealth } from '../services/providerHealth.js';

const router = express.Router();

router.get('/health/messaging', async (req, res) => {
  try {
    const health = await getMessagingHealth();
    res.json(health);
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Erro interno ao obter health de messaging' });
  }
});

export default router;
