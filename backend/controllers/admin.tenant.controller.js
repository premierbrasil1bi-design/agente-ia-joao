import {
  createTenant,
  getAllTenants,
  getTenantById,
  updateTenant,
  deleteTenant
} from '../repositories/tenant.repository.js';

export async function createTenantHandler(req, res) {
  try {
    const tenant = await createTenant(req.body);
    res.status(201).json(tenant);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao criar tenant' });
  }
}

export async function listTenants(req, res) {
  try {
    const tenants = await getAllTenants();
    res.json(tenants);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao listar tenants' });
  }
}

export async function getTenant(req, res) {
  try {
    const tenant = await getTenantById(req.params.id);
    if (!tenant) {
      return res.status(404).json({ error: 'Não encontrado' });
    }
    res.json(tenant);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar tenant' });
  }
}

export async function updateTenantHandler(req, res) {
  try {
    const tenant = await updateTenant(req.params.id, req.body);
    res.json(tenant);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao atualizar tenant' });
  }
}

export async function deleteTenantHandler(req, res) {
  try {
    await deleteTenant(req.params.id);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: 'Erro ao deletar tenant' });
  }
}


