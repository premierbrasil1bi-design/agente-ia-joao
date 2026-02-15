/**
 * Middleware: autenticação AGENTE IA OMNICANAL (JWT exclusivo, isolado do SIS-ACOLHE).
 * Lê header Authorization: Bearer TOKEN. Se inválido → 401. Se válido → req.agent = decoded.
 */

import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import * as agentUsersRepo from '../repositories/agentUsersRepository.js';
import { isConnected } from '../db/connection.js';

function getTokenFromRequest(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  return null;
}

export async function agentAuth(req, res, next) {
  const token = getTokenFromRequest(req);
  if (!token) {
    return res.status(401).json({ error: 'Token ausente. Faça login.' });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, config.agentJwt.secret);
  } catch {
    return res.status(401).json({ error: 'Token inválido ou expirado.' });
  }

  if (!decoded.id && !decoded.sub) {
    return res.status(401).json({ error: 'Token inválido.' });
  }

  const userId = decoded.id || decoded.sub;
  if (isConnected()) {
    try {
      const user = await agentUsersRepo.findById(userId);
      if (!user) {
        return res.status(401).json({ error: 'Usuário não encontrado. Faça login novamente.' });
      }
      req.agent = { id: user.id, name: user.name, email: user.email, role: user.role };
    } catch (err) {
      console.error('[agentAuth] Falha ao validar usuário:', err.message);
      return res.status(401).json({ error: 'Não foi possível validar a sessão. Faça login novamente.' });
    }
  } else {
    req.agent = { id: decoded.id || decoded.sub, email: decoded.email, name: decoded.name || 'Agente', role: decoded.role || 'admin' };
  }

  next();
}
