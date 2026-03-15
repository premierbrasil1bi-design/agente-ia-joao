/**
 * Controller: login e sessão do Client App (OMNIA AI).
 * Usa tabela admins (usuários de tenant criados pelo Global Admin).
 * Login apenas com email + senha; tenant_id é obtido do registro do usuário.
 */

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import * as adminsRepo from '../repositories/adminsRepository.js';
import { isConnected } from '../db/connection.js';

/**
 * POST /api/agent/auth/login
 * Body: { email, password } — tenant_id NÃO é exigido.
 * Retorna: { token, agent: { id, name, email, role, tenant_id } }
 */
export async function login(req, res) {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email e senha são obrigatórios.' });
  }

  if (!isConnected()) {
    return res.status(503).json({ error: 'Banco de dados indisponível.' });
  }

  try {
    const emailClean = String(email).trim().toLowerCase();
    const user = await adminsRepo.findByEmail(emailClean);
    if (!user) {
      return res.status(401).json({ error: 'Email ou senha inválidos.' });
    }

    if (user.active === false) {
      return res.status(403).json({ error: 'Conta suspensa. Entre em contato com o administrador.' });
    }

    if (!user.tenant_id) {
      return res.status(403).json({ error: 'Usuário não vinculado a um tenant.' });
    }

    const hash = user.password_hash;
    if (!hash || typeof hash !== 'string') {
      console.error('[agentAuth.controller] Usuário sem senha definida no banco:', user.email);
      return res.status(500).json({ error: 'Conta sem senha definida. Contate o administrador.' });
    }

    const match = await bcrypt.compare(String(password), hash);
    if (!match) {
      return res.status(401).json({ error: 'Email ou senha inválidos.' });
    }

    const secret = config.agentJwt?.secret;
    if (!secret) {
      console.error('[agentAuth.controller] AGENT_JWT_SECRET não definido');
      return res.status(500).json({ error: 'Configuração do servidor incompleta. Defina AGENT_JWT_SECRET no .env' });
    }

    const token = jwt.sign(
      {
        userId: user.id,
        tenantId: user.tenant_id,
        role: 'tenant_admin',
      },
      secret,
      { expiresIn: config.agentJwt?.expiresIn || '1d' }
    );

    return res.status(200).json({
      token,
      agent: {
        id: user.id,
        name: user.name ?? user.email,
        email: user.email,
        role: 'tenant_admin',
        tenant_id: user.tenant_id,
      },
    });
  } catch (err) {
    const msg = err.message || '';
    console.error('[agentAuth.controller] login:', msg);
    if (msg.includes('does not exist') || msg.includes('relation')) {
      return res.status(503).json({ error: 'Banco de dados indisponível.' });
    }
    if (msg.includes('DATABASE_URL')) {
      return res.status(503).json({ error: 'Banco não configurado. Defina DATABASE_URL no .env do backend.' });
    }
    const safeMsg =
      config.env !== 'production'
        ? msg || String(err)
        : 'Erro ao processar login. Veja o log do servidor.';
    return res.status(500).json({ error: safeMsg });
  }
}
