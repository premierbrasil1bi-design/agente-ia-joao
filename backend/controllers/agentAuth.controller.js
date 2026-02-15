/**
 * Controller: login e sessão AGENTE IA OMNICANAL (isolado do SIS-ACOLHE).
 */

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import * as agentUsersRepo from '../repositories/agentUsersRepository.js';
import { isConnected } from '../db/connection.js';

/**
 * POST /api/agent/auth/login
 * Body: { email, password }
 * Retorna: { token, agent: { id, name, email, role } }
 */
export async function login(req, res) {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email e senha são obrigatórios.' });
  }

  if (!isConnected()) {
    return res.status(503).json({ error: 'Banco de dados indisponível. Crie a tabela agent_users e um usuário.' });
  }

  try {
    const user = await agentUsersRepo.findByEmail(email);
    if (!user) {
      return res.status(401).json({ error: 'Email ou senha inválidos.' });
    }

    const hash = user.password;
    if (!hash || typeof hash !== 'string') {
      console.error('[agentAuth.controller] Usuário sem senha definida no banco:', user.email);
      return res.status(500).json({ error: 'Conta sem senha definida. Rode: node scripts/seed-agent-user.js nova_senha' });
    }

    const match = await bcrypt.compare(password, hash);
    if (!match) {
      return res.status(401).json({ error: 'Email ou senha inválidos.' });
    }

    const secret = config.agentJwt?.secret;
    if (!secret) {
      console.error('[agentAuth.controller] AGENT_JWT_SECRET não definido');
      return res.status(500).json({ error: 'Configuração do servidor incompleta. Defina AGENT_JWT_SECRET no .env' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      secret,
      { expiresIn: config.agentJwt.expiresIn || '1d' }
    );

    return res.status(200).json({
      token,
      agent: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    const msg = err.message || '';
    console.error('[agentAuth.controller] login:', msg);
    if (msg.includes('does not exist') || msg.includes('relation') || msg.includes('agent_users')) {
      return res.status(503).json({
        error: 'Tabela agent_users não existe. Rode no backend: node scripts/run-agent-schema.js admin123',
      });
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
