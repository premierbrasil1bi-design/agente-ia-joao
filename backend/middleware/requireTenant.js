
import { pool } from "../db/pool.js";
import jwt from "jsonwebtoken";
import { config } from "../config/env.js";

export async function requireTenant(req, res, next) {
  try {
    const authHeader = req.headers["authorization"] || req.headers["Authorization"];
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "TENANT_REQUIRED",
        message: "Token JWT ausente ou inválido."
      });
    }
    const token = authHeader.replace("Bearer ", "").trim();
    let payload;
    try {
      payload = jwt.verify(token, config.agentJwt.secret);
    } catch (err) {
      return res.status(401).json({
        error: "TENANT_INVALID_TOKEN",
        message: "Token JWT inválido ou expirado."
      });
    }
    const tenantId = payload.tenantId;
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!tenantId || !uuidRegex.test(String(tenantId))) {
      return res.status(400).json({
        error: "TENANT_INVALID",
        message: "tenant_id inválido (UUID esperado no JWT)."
      });
    }
    const { rows } = await pool.query(
      "SELECT id, active FROM tenants WHERE id = $1 LIMIT 1",
      [tenantId]
    );
    if (rows.length === 0) {
      return res.status(403).json({
        error: "TENANT_NOT_FOUND"
      });
    }
    if (rows[0].active !== true) {
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
