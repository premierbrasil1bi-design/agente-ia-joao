/**
 * Rotas de tenant-users (Global Admin).
 * GET /api/global-admin/tenant-users está em globalAdmin.routes.js.
 * Aqui: POST, PATCH :id, PATCH :id/toggle-active, PATCH :id/reset-password, DELETE :id
 */

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import globalAdminAuth from '../middlewares/globalAdminAuth.js';
import * as adminsRepo from '../repositories/adminsRepository.js';
import { pool } from '../db/pool.js';
import { sendBadRequest, sendNotFound, sendServerError } from '../utils/errorResponses.js';
import { logGlobalAdminAction, ACTIONS } from '../utils/auditLog.js';

const router = Router();

/** POST /api/tenant-users – criar usuário do tenant */
router.post('/', globalAdminAuth, async (req, res) => {
  try {
    const { tenant_id, email, password, name } = req.body || {};
    if (!tenant_id || !email || !password) {
      return sendBadRequest(res, 'tenant_id, email e password são obrigatórios.');
    }
    const tenantId = String(tenant_id).trim();
    const emailClean = String(email).trim().toLowerCase();
    const { rows: tenantRows } = await pool.query('SELECT id FROM tenants WHERE id = $1', [tenantId]);
    if (tenantRows.length === 0) {
      return sendBadRequest(res, 'Tenant não encontrado.');
    }
    const existing = await adminsRepo.findByEmail(emailClean);
    if (existing) {
      return sendBadRequest(res, 'Já existe um usuário com este email.');
    }
    const passwordHash = await bcrypt.hash(String(password), 10);
    const user = await adminsRepo.create(
      tenantId,
      { email: emailClean, password, name },
      passwordHash
    );
    logGlobalAdminAction(ACTIONS.tenant_user_created, user.id).catch(() => {});
    res.status(201).json({
      id: user.id,
      tenant_id: user.tenant_id,
      email: user.email,
      name: user.name,
      created_at: user.created_at,
    });
  } catch (err) {
    console.error('[tenant-users] POST:', err.message);
    sendServerError(res, 'Erro ao criar usuário do tenant.', err);
  }
});

/** PATCH /api/tenant-users/:id – atualizar email e/ou name */
router.patch('/:id', globalAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const user = await adminsRepo.findById(id);
    if (!user) return sendNotFound(res, 'Usuário não encontrado.');
    if (!user.tenant_id) return sendBadRequest(res, 'Usuário não pertence a um tenant.');
    const { email, name } = req.body || {};
    const data = {};
    if (email !== undefined) data.email = String(email).trim().toLowerCase();
    if (name !== undefined) data.name = name;
    if (Object.keys(data).length === 0) {
      return res.status(200).json(user);
    }
    if (data.email) {
      const existing = await adminsRepo.findByEmail(data.email);
      if (existing && existing.id !== id) {
        return sendBadRequest(res, 'Já existe um usuário com este email.');
      }
    }
    const updated = await adminsRepo.updateUser(id, data);
    logGlobalAdminAction(ACTIONS.tenant_user_updated, id).catch(() => {});
    res.status(200).json(updated);
  } catch (err) {
    console.error('[tenant-users] PATCH:', err.message);
    sendServerError(res, 'Erro ao atualizar usuário.', err);
  }
});

/** PATCH /api/tenant-users/:id/toggle-active – ativar/desativar */
router.patch('/:id/toggle-active', globalAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const user = await adminsRepo.findById(id);
    if (!user) return sendNotFound(res, 'Usuário não encontrado.');
    if (!user.tenant_id) return sendBadRequest(res, 'Usuário não pertence a um tenant.');
    const active = req.body?.active;
    if (typeof active !== 'boolean') {
      return sendBadRequest(res, 'active (true ou false) é obrigatório no body.');
    }
    if (!active) {
      const count = await adminsRepo.countActiveUsersByTenant(user.tenant_id);
      if (count <= 1) {
        return sendBadRequest(
          res,
          'Não é possível desativar o último usuário ativo do tenant. Cadastre outro usuário antes.'
        );
      }
    }
    const updated = await adminsRepo.toggleActive(id, active);
    logGlobalAdminAction(ACTIONS.tenant_user_toggled, id).catch(() => {});
    res.status(200).json(updated);
  } catch (err) {
    console.error('[tenant-users] toggle-active:', err.message);
    sendServerError(res, 'Erro ao alterar status do usuário.', err);
  }
});

/** PATCH /api/tenant-users/:id/reset-password */
router.patch('/:id/reset-password', globalAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body || {};
    if (!password || String(password).length < 6) {
      return sendBadRequest(res, 'password é obrigatório (mínimo 6 caracteres).');
    }
    const user = await adminsRepo.findById(id);
    if (!user) return sendNotFound(res, 'Usuário não encontrado.');
    if (!user.tenant_id) return sendBadRequest(res, 'Usuário não pertence a um tenant.');
    const passwordHash = await bcrypt.hash(String(password), 10);
    await adminsRepo.updatePassword(id, passwordHash);
    logGlobalAdminAction(ACTIONS.tenant_user_password_reset, id).catch(() => {});
    res.status(200).json({ ok: true, message: 'Senha redefinida.' });
  } catch (err) {
    console.error('[tenant-users] reset-password:', err.message);
    sendServerError(res, 'Erro ao redefinir senha.', err);
  }
});

/** DELETE /api/tenant-users/:id */
router.delete('/:id', globalAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const user = await adminsRepo.findById(id);
    if (!user) return sendNotFound(res, 'Usuário não encontrado.');
    if (!user.tenant_id) return sendBadRequest(res, 'Usuário não pertence a um tenant.');
    const count = await adminsRepo.countActiveUsersByTenant(user.tenant_id);
    if (count <= 1) {
      return sendBadRequest(
        res,
        'Não é possível excluir o último usuário ativo do tenant. Desative-o ou cadastre outro usuário antes.'
      );
    }
    await adminsRepo.deleteUser(id);
    logGlobalAdminAction(ACTIONS.tenant_user_deleted, id).catch(() => {});
    res.status(200).json({ ok: true, message: 'Usuário excluído.' });
  } catch (err) {
    console.error('[tenant-users] DELETE:', err.message);
    sendServerError(res, 'Erro ao excluir usuário.', err);
  }
});

export default router;
