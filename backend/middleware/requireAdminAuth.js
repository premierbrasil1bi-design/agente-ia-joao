/**
 * Middleware: exige autenticação ADMIN (JWT).
 * Token em: Authorization: Bearer <token> ou query ?token=...
 * Anexa req.admin = { id, email, name }.
 * Nunca retorna 500: qualquer falha de validação → 401 (Unauthorized) com mensagem clara.
 */

import * as authService from '../services/authService.js';
import * as adminsRepo from '../repositories/adminsRepository.js';
import { isConnected } from '../db/connection.js';
import { sendUnauthorized } from '../utils/errorResponses.js';

function getTokenFromRequest(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  return req.query.token || null;
}

/**
 * requireAdminAuth – protege /api/dashboard/*.
 * Erro de autenticação (token inválido, admin não encontrado, falha no banco) → 401.
 */
export async function requireAdminAuth(req, res, next) {
  const token = getTokenFromRequest(req);
  if (!token) {
    return sendUnauthorized(res, 'Token ausente. Faça login.');
  }

  const decoded = authService.verifyToken(token);
  if (!decoded || !decoded.sub) {
    return sendUnauthorized(res, 'Token inválido ou expirado.');
  }

  if (isConnected()) {
    try {
      const admin = await adminsRepo.findById(decoded.sub);
      if (!admin) {
        console.error('[requireAdminAuth] Admin não encontrado no banco:', decoded.sub);
        return sendUnauthorized(res, 'Usuário não encontrado. Faça login novamente.');
      }
      req.admin = { id: admin.id, email: admin.email, name: admin.name };
    } catch (err) {
      console.error('[requireAdminAuth] Falha ao validar admin no banco:', err.message);
      return sendUnauthorized(res, 'Não foi possível validar a sessão. Faça login novamente.');
    }
  } else {
    req.admin = { id: decoded.sub, email: decoded.email, name: 'Administrador' };
  }

  next();
}
