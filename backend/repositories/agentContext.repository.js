import { pool } from '../db/pool.js';

export async function getAgentContext(tenantId, agentId) {
  const { rows } = await pool.query(
    `SELECT * FROM agent_contexts
     WHERE tenant_id = $1 AND agent_id = $2
     LIMIT 1`,
    [tenantId, agentId]
  );
  return rows[0] || null;
}

export async function upsertAgentContext(tenantId, agentId, data) {
  const {
    company_name,
    business_description,
    business_type,
    working_hours,
    address,
    services,
    rules,
    tone
  } = data;

  const servicesJson = services != null ? JSON.stringify(services) : null;
  const rulesJson = rules != null ? JSON.stringify(rules) : null;

  const { rows } = await pool.query(
    `
    INSERT INTO agent_contexts (
      tenant_id,
      agent_id,
      company_name,
      business_description,
      business_type,
      working_hours,
      address,
      services,
      rules,
      tone
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10)
    ON CONFLICT (tenant_id, agent_id)
    DO UPDATE SET
      company_name = EXCLUDED.company_name,
      business_description = EXCLUDED.business_description,
      business_type = EXCLUDED.business_type,
      working_hours = EXCLUDED.working_hours,
      address = EXCLUDED.address,
      services = EXCLUDED.services,
      rules = EXCLUDED.rules,
      tone = EXCLUDED.tone,
      updated_at = now()
    RETURNING *
    `,
    [
      tenantId,
      agentId,
      company_name ?? null,
      business_description ?? null,
      business_type ?? null,
      working_hours ?? null,
      address ?? null,
      servicesJson,
      rulesJson,
      tone ?? null
    ]
  );
  return rows[0];
}
