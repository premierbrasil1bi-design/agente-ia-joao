import express from 'express';
import {
  createTenantHandler,
  listTenants,
  getTenant,
  updateTenantHandler,
  deleteTenantHandler
} from '../../controllers/admin.tenant.controller.js';
import { requireMasterAdmin } from '../../middleware/requireMasterAdmin.js';

const router = express.Router();

// Todas rotas protegidas por master
router.use(requireMasterAdmin);

router.post('/', createTenantHandler);
router.get('/', listTenants);
router.get('/:id', getTenant);
router.put('/:id', updateTenantHandler);
router.delete('/:id', deleteTenantHandler);

export default router;
