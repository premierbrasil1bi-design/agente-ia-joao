import { Router } from 'express';
import { getTenantById } from '../repositories/tenant.repository.js';
import { getEffectiveProvidersForTenant } from '../services/providerPlanAccess.service.js';

const router = Router();

router.get('/allowed', async (req, res) => {
  try {
    const tenantId = req.tenantId || req.user?.tenantId;
    if (!tenantId) return res.status(401).json({ error: 'Tenant não identificado.' });
    const tenant = await getTenantById(tenantId);
    if (!tenant) return res.status(404).json({ error: 'Tenant não encontrado.' });
    return res.status(200).json({
      tenantId,
      allowedProviders: getEffectiveProvidersForTenant(tenant),
    });
  } catch (err) {
    console.error('[providers] allowed:', err.message);
    return res.status(500).json({ error: 'Erro ao obter providers permitidos.' });
  }
});

export default router;

