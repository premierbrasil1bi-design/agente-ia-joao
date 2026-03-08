import jwt from "jsonwebtoken";
import { config } from "../config/env.js";

/**
 * Autenticação JWT: aceita token do tenant (AGENT_JWT_SECRET) ou token admin (JWT_SECRET).
 * Garante req.user = decoded para uso por requireActiveTenant (req.user.tenantId).
 */
export default function authJWT(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "TOKEN_REQUIRED"
      });
    }

    const token = authHeader.split(" ")[1];
    let decoded;

    try {
      decoded = jwt.verify(token, config.agentJwt?.secret || process.env.AGENT_JWT_SECRET);
    } catch {
      try {
        decoded = jwt.verify(token, config.jwt?.secret || process.env.JWT_SECRET);
      } catch {
        return res.status(401).json({
          error: "TOKEN_INVALID"
        });
      }
    }

    req.user = decoded;

    next();
  } catch (error) {
    return res.status(401).json({
      error: "TOKEN_INVALID"
    });
  }
}
