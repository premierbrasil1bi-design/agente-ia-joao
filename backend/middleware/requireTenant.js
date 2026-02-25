import { pool } from "../db/pool.js";

export async function requireTenant(req, res, next) {
  try {
    const tenantId =
      req.headers["x-tenant-id"] ||
      req.headers["x-tenant"];

    if (!tenantId) {
      return res.status(401).json({
        error: "TENANT_REQUIRED",
        message: "Informe o tenant via header x-tenant-id."
      });
    }

    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    if (!uuidRegex.test(String(tenantId))) {
      return res.status(400).json({
        error: "TENANT_INVALID",
        message: "tenant_id inválido (UUID esperado)."
      });
    }

    const { rows } = await pool.query(
      "SELECT id, status FROM tenants WHERE id = $1 LIMIT 1",
      [tenantId]
    );

    if (rows.length === 0) {
      return res.status(403).json({
        error: "TENANT_NOT_FOUND"
      });
    }

    if (rows[0].status && rows[0].status !== "ativo") {
      return res.status(403).json({
        error: "TENANT_INACTIVE"
      });
    }

    req.tenantId = rows[0].id;

    next();
  } catch (error) {
    console.error("Tenant middleware error:", error);
    return res.status(500).json({
      error: "TENANT_MIDDLEWARE_ERROR"
    });
  }
}
