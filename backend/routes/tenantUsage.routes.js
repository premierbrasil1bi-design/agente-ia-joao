import express from 'express';
import { pool } from '../db/pool.js';
import authJWT from '../middleware/authJWT.js';
import { requireActiveTenant } from '../middleware/requireActiveTenant.js';

const router = express.Router();

router.get(
  '/usage',
  authJWT,
  requireActiveTenant,
  async (req, res) => {
    try {
      const tenantId = req.user.tenantId;

      const { rows } = await pool.query(
        `
        SELECT
          plan,
          max_agents,
          max_messages,
          agents_used_current_period as used_agents,
          messages_used_current_period as used_messages,
          billing_cycle_start
        FROM tenants
        WHERE id = $1
        `,
        [tenantId]
      );

      if (!rows.length) {
        return res.status(404).json({ error: 'Tenant não encontrado' });
      }

      return res.json(rows[0]);
    } catch (error) {
      console.error('Erro tenant usage:', error);
      return res.status(500).json({ error: 'Erro interno' });
    }
  }
);

export default router;
