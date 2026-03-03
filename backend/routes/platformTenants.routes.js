import express from 'express';
import globalAdminAuth from '../middlewares/globalAdminAuth.js';
import {
  createTenantHandler,
  listTenants,
  getTenant,
  updateTenantHandler,
  deleteTenantHandler,
} from '../controllers/admin.tenant.controller.js';

const router = express.Router();

// Todas as rotas de /api/platform/tenants são protegidas por Global Admin
router.use(globalAdminAuth);

// Lista tenants (admin global)
router.get('/tenants', listTenants);

// Cria tenant (admin global)
router.post('/tenants', createTenantHandler);

// Detalhe de um tenant
router.get('/tenants/:id', getTenant);

// Atualização parcial de tenant (SaaS admin usa PATCH)
router.patch('/tenants/:id', updateTenantHandler);

// Exclusão de tenant (opcional, mantido por compatibilidade com controller)
router.delete('/tenants/:id', deleteTenantHandler);

export default router;

