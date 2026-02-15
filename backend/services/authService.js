/**
 * Serviço de autenticação ADMIN.
 * Login com email + senha (bcrypt). Gera JWT com expiração.
 * Sem Neon: login mock (admin@exemplo.com / admin123) para desenvolvimento.
 */

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { isConnected } from '../db/connection.js';
import { config } from '../config/env.js';
import * as adminsRepo from '../repositories/adminsRepository.js';

const MOCK_EMAIL = 'admin@exemplo.com';
const MOCK_PASSWORD = 'admin123';

function mockAdminAndToken() {
  const admin = { id: 'mock-admin-id', email: MOCK_EMAIL, name: 'Administrador (mock)' };
  const token = jwt.sign(
    { sub: admin.id, email: admin.email },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
  return { admin, token };
}

/**
 * Valida credenciais e retorna { admin, token } ou null.
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{ admin: { id, email, name }, token: string } | null>}
 */
export async function login(email, password) {
  if (!email || !password) return null;

  // Sem Neon: login mock (desenvolvimento)
  if (!isConnected()) {
    if (email === MOCK_EMAIL && password === MOCK_PASSWORD) {
      return mockAdminAndToken();
    }
    return null;
  }

  try {
    const admin = await adminsRepo.findByEmail(email);
    if (admin) {
      const match = await bcrypt.compare(password, admin.password_hash);
      if (match) {
        const token = jwt.sign(
          { sub: admin.id, email: admin.email },
          config.jwt.secret,
          { expiresIn: config.jwt.expiresIn }
        );
        return { admin: { id: admin.id, email: admin.email, name: admin.name }, token };
      }
    }
    return null;
  } catch (err) {
    console.error('authService.login:', err.message);
    return null;
  }
}

/**
 * Valida JWT e retorna o payload (sub = admin id) ou null.
 * @param {string} token
 * @returns {Promise<{ sub: string, email: string } | null>}
 */
export function verifyToken(token) {
  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    return decoded;
  } catch {
    return null;
  }
}
