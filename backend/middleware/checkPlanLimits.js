import { pool } from '../db/pool.js';

export async function checkAgentLimit(req, res, next) {
  try {
    const tenantId = req.user?.tenantId;

    const { rows } = await pool.query(
      `
      SELECT max_agents, agents_used_current_period
      FROM tenants
      WHERE id = $1
      `,
      [tenantId]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Tenant não encontrado' });
    }

    const { max_agents, agents_used_current_period } = rows[0];

    if (agents_used_current_period >= max_agents) {
      return res.status(403).json({
        error: 'Limite de agentes atingido no plano atual'
      });
    }

    next();
  } catch (error) {
    console.error('Erro checkAgentLimit:', error);
    return res.status(500).json({ error: 'Erro interno' });
  }
}
