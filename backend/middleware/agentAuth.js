/**
 * Middleware: autenticação das rotas /api/agent/* (Client App OMNIA AI).
 * Lê Authorization: Bearer <token>, valida JWT com AGENT_JWT_SECRET e anexa req.user e req.tenantId.
 */

import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';

export async function agentAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'Token não fornecido' });
  }

  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : authHeader;

  if (!token) {
    return res.status(401).json({ error: 'Token não fornecido' });
  }

  const secret = config.agentJwt?.secret;
  if (!secret) {
    console.error('[agentAuth] AGENT_JWT_SECRET não definido');
    return res.status(500).json({ error: 'Configuração do servidor incompleta.' });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, secret);
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido ou expirado.' });
  }

  const userId = decoded.userId || decoded.id || decoded.sub;
  if (!userId) {
    return res.status(401).json({ error: 'Token inválido.' });
  }

  req.user = decoded;
  req.tenantId = decoded.tenantId ?? decoded.tenant_id ?? null;

  next();
}
