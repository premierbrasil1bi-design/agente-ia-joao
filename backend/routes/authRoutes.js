/**
 * Rotas de autenticação ADMIN.
 * POST /api/auth/login – email + password, retorna { admin, token }.
 */

import { Router } from 'express';
import * as authService from '../services/authService.js';
import { sanitizeEmail } from '../utils/sanitize.js';
import { sendUnauthorized, sendServerError } from '../utils/errorResponses.js';

const router = Router();

/**
 * POST /api/auth/login
 * Body: { email, password }
 * Resposta: { admin: { id, email, name }, token } ou 401.
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const emailClean = sanitizeEmail(email);
    const passwordClean = typeof password === 'string' ? password.trim().slice(0, 200) : '';
    const result = await authService.login(emailClean, passwordClean);
    if (!result) {
      return sendUnauthorized(res, 'Email ou senha inválidos.');
    }
    res.status(200).json(result);
  } catch (err) {
    return sendServerError(res, 'Erro ao fazer login.', err);
  }
});

export default router;
