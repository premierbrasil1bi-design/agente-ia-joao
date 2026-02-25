import { pool } from "../db/pool.js";

export async function tenantQuery(req, baseQuery, params = []) {
  if (!req.tenantId) {
    throw new Error("Tenant não definido no request.");
  }

  const query = `
    ${baseQuery}
    AND tenant_id = $${params.length + 1}
  `;

  return pool.query(query, [...params, req.tenantId]);
}
