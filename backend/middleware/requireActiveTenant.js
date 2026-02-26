import { pool } from '../db/pool.js';

export async function requireActiveTenant(req, res, next) {
  try {
    const tenantId = req.user?.tenantId;

    if (!tenantId) {
      return res.status(401).json({ error: 'Tenant não identificado' });
    }

    const { rows } = await pool.query(
      'SELECT status FROM tenants WHERE id = $1',
      [tenantId]
    );

    if (!rows.length || rows[0].status !== 'ativo') {
      return res.status(403).json({
        error: 'Tenant inativo ou suspenso'
      });
    }

    next();
  } catch (error) {
    console.error('Erro requireActiveTenant:', error);
    return res.status(500).json({ error: 'Erro interno' });
  }
}
