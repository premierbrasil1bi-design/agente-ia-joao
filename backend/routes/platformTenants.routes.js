import express from 'express';
import globalAdminAuth from '../middlewares/globalAdminAuth.js';
import {
  createTenantHandler,
  listTenants,
  getTenant,
  updateTenantHandler,
  deleteTenantHandler,
} from '../controllers/admin.tenant.controller.js';
import {
  patchTenantFeaturesHandler,
  getTenantFeatureFlagHistoryHandler,
  postRevertTenantFeaturesHandler,
  getFeatureTemplatesHandler,
  postApplyFeatureTemplateHandler,
} from '../controllers/platformTenantFeatures.controller.js';

const router = express.Router();

// Todas as rotas de /api/platform/tenants são protegidas por Global Admin
router.use(globalAdminAuth);

// Templates de feature flags (admin global)
router.get('/feature-templates', getFeatureTemplatesHandler);

// Lista tenants (admin global)
router.get('/tenants', listTenants);

// Cria tenant (admin global)
router.post('/tenants', createTenantHandler);

// Histórico de overrides de feature flags (antes de /tenants/:id por clareza de roteamento)
router.get('/tenants/:id/features/history', getTenantFeatureFlagHistoryHandler);

// Reverter overrides para o estado anterior registrado em uma linha de auditoria
router.post('/tenants/:id/features/revert/:auditId', postRevertTenantFeaturesHandler);

// Detalhe de um tenant
router.get('/tenants/:id', getTenant);

// Aplicar preset de feature flags (SUPER_ADMIN / GLOBAL_ADMIN)
router.post('/tenants/:id/features/apply-template', postApplyFeatureTemplateHandler);

// Overrides de feature flags (SUPER_ADMIN / GLOBAL_ADMIN)
router.patch('/tenants/:id/features', patchTenantFeaturesHandler);

// Atualização parcial de tenant (SaaS admin usa PATCH)
router.patch('/tenants/:id', updateTenantHandler);

// Exclusão de tenant (opcional, mantido por compatibilidade com controller)
router.delete('/tenants/:id', deleteTenantHandler);

export default router;

