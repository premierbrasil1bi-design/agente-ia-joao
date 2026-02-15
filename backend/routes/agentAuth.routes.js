/**
 * Rotas AGENTE IA OMNICANAL: /api/agent/auth e /api/agent/dashboard (isolado do SIS-ACOLHE).
 */

import { Router } from 'express';
import { agentAuth } from '../middleware/agentAuth.js';
import * as agentAuthController from '../controllers/agentAuth.controller.js';

const router = Router();

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

// POST /api/agent/auth/login (montado em /api/agent, então path = /auth/login)
router.post('/auth/login', asyncHandler(agentAuthController.login));

// GET /api/agent/dashboard/summary – protegido, retorno mockado
router.get('/dashboard/summary', agentAuth, (req, res) => {
  res.status(200).json({
    canalAtivo: 'web',
    mensagensEnviadas: 0,
    mensagensRecebidas: 0,
    tokensEstimados: 0,
    totalGastoMes: 0,
    agentStatus: 'ok',
    alertas: [],
  });
});

export default router;
