
export async function checkMessageLimit(req, res, next) {
  try {
    const tenantId = req.user?.tenantId;

    if (!tenantId) {
      return res.status(401).json({ error: 'Tenant não identificado' });
    }

    // 1) Reset automático do ciclo se necessário (30 dias)
    // 2) Incremento ATÔMICO com condição de limite, tudo no banco
    // Observação: incrementa 1 por padrão (rota /message).
    const quantity = 1;

    // Primeiro: tenta resetar se o ciclo venceu (sem depender de JOIN/SUM)
    await pool.query(
      `
      import { pool } from '../db/pool.js';

      export async function checkMessageLimit(req, res, next) {
        try {
          const tenantId = req.user?.tenantId;

          if (!tenantId) {
            return res.status(401).json({ error: 'Tenant não identificado' });
          }

          const { rows } = await pool.query(
            `
            SELECT 
              t.messages_used_current_period,
              t.billing_cycle_start,
              p.max_messages,
              p.billing_cycle_days
            FROM tenants t
            JOIN plans p ON t.plan_id = p.id
            WHERE t.id = $1
            `,
            [tenantId]
          );

          if (!rows.length) {
            return res.status(404).json({ error: 'Tenant não encontrado' });
          }

          const {
            messages_used_current_period,
            billing_cycle_start,
            max_messages,
            billing_cycle_days
          } = rows[0];

          const now = new Date();
          const cycleStart = new Date(billing_cycle_start);
          const diffDays = (now - cycleStart) / (1000 * 60 * 60 * 24);

          if (diffDays >= billing_cycle_days) {
            await pool.query(
              `
              UPDATE tenants
              SET 
                messages_used_current_period = 0,
                billing_cycle_start = NOW()
              WHERE id = $1
              `,
              [tenantId]
            );
            return next();
          }

          if (Number(messages_used_current_period) >= max_messages) {
            return res.status(403).json({
              error: 'Limite de mensagens atingido no plano atual'
            });
          }

          next();
        } catch (error) {
          console.error('Erro checkMessageLimit:', error);
          return res.status(500).json({ error: 'Erro interno' });
        }
      }
    return res.status(403).json({
