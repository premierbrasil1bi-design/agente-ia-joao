import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import { sendUnauthorized } from '../utils/errorResponses.js';

function getJwtSecret() {
  const secret = config.jwt?.secret || process.env.JWT_SECRET;
  if (!secret || (config.isProduction && secret === 'change-me-in-production')) {
    return null;
  }
  return secret;
}

export default function globalAdminAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return sendUnauthorized(res, 'Token ausente. Faça login.');
  }
  const token = authHeader.slice(7);
  const secret = getJwtSecret();
  if (!secret) {
    return sendUnauthorized(res, 'Configuração do servidor incompleta.');
  }
  try {
    const decoded = jwt.verify(token, secret);
    const role = String(decoded.role || '');
    if (role !== 'GLOBAL_ADMIN' && role !== 'SUPER_ADMIN') {
      return sendUnauthorized(res, 'Acesso restrito ao administrador da plataforma (SUPER_ADMIN).');
    }
    req.globalAdmin = {
      id: decoded.globalAdminId,
      email: decoded.email,
      role: decoded.role,
    };
    next();
  } catch (err) {
    return sendUnauthorized(res, 'Token inválido ou expirado.');
  }
}
