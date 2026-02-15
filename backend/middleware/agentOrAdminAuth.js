/**
 * Aceita JWT do AGENTE IA (agent_token) ou JWT do admin antigo.
 * Anexa req.admin em ambos os casos para compatibilidade com rotas /api/dashboard e /api/agents.
 */

import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import * as authService from '../services/authService.js';
import * as adminsRepo from '../repositories/adminsRepository.js';
import * as agentUsersRepo from '../repositories/agentUsersRepository.js';
import { isConnected } from '../db/connection.js';
import { sendUnauthorized } from '../utils/errorResponses.js';

function getTokenFromRequest(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) return authHeader.slice(7);
  return req.query.token || null;
}

export async function agentOrAdminAuth(req, res, next) {
  const token = getTokenFromRequest(req);
  if (!token) {
    return sendUnauthorized(res, 'Token ausente. Faça login.');
  }

  const userId = (d) => d.id || d.sub;

  try {
    const agentDecoded = jwt.verify(token, config.agentJwt.secret);
    if (agentDecoded && userId(agentDecoded)) {
      if (isConnected()) {
        const user = await agentUsersRepo.findById(userId(agentDecoded));
        if (user) {
          req.admin = { id: user.id, email: user.email, name: user.name };
          return next();
        }
      } else {
        req.admin = { id: userId(agentDecoded), email: agentDecoded.email, name: agentDecoded.name || 'Agente' };
        return next();
      }
    }
  } catch {
    // não é token do agente, tenta admin
  }

  const decoded = authService.verifyToken(token);
  if (!decoded || !decoded.sub) {
    return sendUnauthorized(res, 'Token inválido ou expirado.');
  }

  if (isConnected()) {
    try {
      const admin = await adminsRepo.findById(decoded.sub);
      if (!admin) return sendUnauthorized(res, 'Usuário não encontrado. Faça login novamente.');
      req.admin = { id: admin.id, email: admin.email, name: admin.name };
    } catch (err) {
      console.error('[agentOrAdminAuth] Falha ao validar admin:', err.message);
      return sendUnauthorized(res, 'Não foi possível validar a sessão. Faça login novamente.');
    }
  } else {
    req.admin = { id: decoded.sub, email: decoded.email, name: 'Administrador' };
  }

  next();
}
