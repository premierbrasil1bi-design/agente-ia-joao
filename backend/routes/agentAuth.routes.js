/**
 * Rotas públicas do Client App (login).
 * Montado em /api/agent/auth → POST /api/agent/auth/login (público, sem agentAuth).
 * Dashboard/summary e demais rotas protegidas estão em agentRouter no server.js.
 */

import { Router } from 'express';
import * as agentAuthController from '../controllers/agentAuth.controller.js';

const router = Router();

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

// POST /login → quando montado em /auth: POST /api/agent/auth/login
router.post('/login', asyncHandler(agentAuthController.login));

export default router;
