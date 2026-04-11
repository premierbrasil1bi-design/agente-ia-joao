import { log } from '../utils/logger.js';
import { pool } from '../db/pool.js';
import { getTenantById, updateTenantFeatureFlags } from '../repositories/tenant.repository.js';
import { getBaseFeaturesForPlan } from '../config/planFeatures.config.js';
import {
  computeFeaturesForTenantRow,
  validateTenantFeatureFlags,
} from '../services/tenantFeatures.service.js';
import { invalidateTenantLimitsCache } from '../services/tenantLimits.service.js';
import { PLAN_FEATURE_KEYS } from '../config/planFeatures.config.js';
import {
  insertTenantFeatureFlagAudit,
  getTenantFeatureFlagAudit,
  getTenantFeatureFlagAuditById,
} from '../repositories/tenantFeatureFlagAudit.repository.js';
import { getFeatureTemplateByKey, listFeatureTemplatesForApi } from '../config/featureFlagTemplates.config.js';

/**
 * `feature_flags` no body = mapa esparso completo desejado (substitui o JSONB).
 * Remove chaves redundantes em relação ao plano atual.
 * @param {Record<string, boolean>} sparse
 * @param {Record<string, boolean>} planBase
 */
function normalizeSparseOverrides(sparse, planBase) {
  const out = { ...sparse };
  for (const key of PLAN_FEATURE_KEYS) {
    if (out[key] === planBase[key]) delete out[key];
  }
  return out;
}

/** Compara apenas overrides esparsos conhecidos (chaves fora de PLAN_FEATURE_KEYS ignoradas na origem). */
function sparseOverrideMapsEqual(a, b) {
  for (const key of PLAN_FEATURE_KEYS) {
    const hasA = Object.prototype.hasOwnProperty.call(a, key);
    const hasB = Object.prototype.hasOwnProperty.call(b, key);
    if (hasA !== hasB) return false;
    if (hasA && a[key] !== b[key]) return false;
  }
  return true;
}

function changedByFromRequest(req) {
  return (
    req.globalAdmin?.email ||
    (req.globalAdmin?.id != null ? String(req.globalAdmin.id) : null) ||
    'unknown'
  );
}

/**
 * @param {{
 *   operation: 'patch_features' | 'revert_features' | 'apply_template',
 *   tenantId: string,
 *   auditId?: string | null,
 *   requestId?: string | null,
 *   exec: (client: import('pg').PoolClient) => Promise<{ auditRowId?: string | null, [key: string]: unknown }>,
 * }} opts
 */
async function withTenantFeatureFlagsTransaction(opts) {
  const { operation, tenantId, auditId = null, requestId = null, exec } = opts;
  const client = await pool.connect();
  let begun = false;
  try {
    await client.query('BEGIN');
    begun = true;
    log.info({
      event: 'TENANT_FEATURE_FLAGS_TRANSACTION_STARTED',
      context: 'platform',
      operation,
      tenantId,
      auditId: auditId || null,
      requestId: requestId ?? null,
    });
    const execResult = await exec(client);
    await client.query('COMMIT');
    const committedAuditId = execResult?.auditRowId ?? auditId ?? null;
    log.info({
      event: 'TENANT_FEATURE_FLAGS_TRANSACTION_COMMITTED',
      context: 'platform',
      operation,
      tenantId,
      auditId: committedAuditId,
      requestId: requestId ?? null,
    });
    return execResult;
  } catch (err) {
    if (begun) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore rollback errors */
      }
    }
    log.warn({
      event: 'TENANT_FEATURE_FLAGS_TRANSACTION_ROLLED_BACK',
      context: 'platform',
      operation,
      tenantId,
      auditId: auditId || null,
      requestId: requestId ?? null,
      error: err?.message || String(err),
    });
    throw err;
  } finally {
    client.release();
  }
}

/**
 * PATCH /api/platform/tenants/:id/features
 * SUPER_ADMIN / GLOBAL_ADMIN (JWT plataforma).
 */
export async function patchTenantFeaturesHandler(req, res) {
  const requestId = req.requestId ?? null;
  try {
    const tenantId = String(req.params.id || '').trim();
    if (!tenantId) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    const body = req.body;
    if (!body || typeof body.feature_flags !== 'object' || body.feature_flags === null || Array.isArray(body.feature_flags)) {
      return res.status(400).json({ error: 'Body inválido: feature_flags deve ser um objeto' });
    }

    const tenant = await getTenantById(tenantId);
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant não encontrado' });
    }

    const planBase = getBaseFeaturesForPlan(tenant.plan);
    const validatedBody = validateTenantFeatureFlags(body.feature_flags);
    const newStored = normalizeSparseOverrides(validatedBody, planBase);

    const previousStored = validateTenantFeatureFlags(tenant.feature_flags);
    const effectivePreviousFlags = { ...computeFeaturesForTenantRow(tenant) };
    const previousFlags = { ...effectivePreviousFlags };

    const updatedBy = changedByFromRequest(req);

    const { newFlags, auditRow } = await withTenantFeatureFlagsTransaction({
      operation: 'patch_features',
      tenantId,
      auditId: null,
      requestId,
      exec: async (client) => {
        const updatedRow = await updateTenantFeatureFlags(tenantId, newStored, client);
        const computed = { ...computeFeaturesForTenantRow(updatedRow) };
        const row = await insertTenantFeatureFlagAudit(
          {
            tenantId,
            changedBy: updatedBy,
            previousFlags: previousStored,
            newFlags: newStored,
            effectivePreviousFlags,
            effectiveNewFlags: computed,
          },
          client,
        );
        return { newFlags: computed, auditRow: row, auditRowId: row?.id ?? null };
      },
    });

    log.info({
      event: 'TENANT_FEATURE_FLAGS_UPDATED',
      context: 'platform',
      tenantId,
      previousFlags,
      newFlags,
      updatedBy,
      requestId,
    });

    if (auditRow?.id) {
      log.info({
        event: 'TENANT_FEATURE_FLAGS_AUDIT_CREATED',
        context: 'platform',
        tenantId,
        auditId: auditRow.id,
        updatedBy,
        requestId,
      });
    }

    invalidateTenantLimitsCache(tenantId);

    return res.status(200).json({
      tenant_id: tenantId,
      feature_flags: newStored,
      effective_feature_flags: newFlags,
    });
  } catch (err) {
    log.error({
      event: 'TENANT_FEATURE_FLAGS_UPDATE_FAILED',
      context: 'platform',
      error: err?.message || String(err),
      requestId,
    });
    return res.status(500).json({ error: 'Erro ao atualizar feature flags' });
  }
}

/**
 * GET /api/platform/tenants/:id/features/history
 */
export async function getTenantFeatureFlagHistoryHandler(req, res) {
  const requestId = req.requestId ?? null;
  try {
    const tenantId = String(req.params.id || '').trim();
    if (!tenantId) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    const tenant = await getTenantById(tenantId);
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant não encontrado' });
    }

    const limitRaw = req.query?.limit;
    const limit = limitRaw !== undefined && limitRaw !== null ? Number(limitRaw) : 20;

    const rows = await getTenantFeatureFlagAudit(tenantId, limit);
    const updatedBy = changedByFromRequest(req);

    log.info({
      event: 'TENANT_FEATURE_FLAGS_HISTORY_REQUESTED',
      context: 'platform',
      tenantId,
      updatedBy,
      limit: Math.min(100, Math.max(1, Number(limit) || 20)),
      requestId,
    });

    const items = rows.map((r) => ({
      id: r.id,
      changed_by: r.changed_by,
      previous_flags: r.previous_flags ?? {},
      new_flags: r.new_flags ?? {},
      effective_previous_flags: r.effective_previous_flags ?? {},
      effective_new_flags: r.effective_new_flags ?? {},
      created_at: r.created_at,
    }));

    return res.status(200).json({ items });
  } catch (err) {
    log.error({
      event: 'TENANT_FEATURE_FLAGS_HISTORY_FAILED',
      context: 'platform',
      tenantId: String(req.params.id || '').trim() || null,
      error: err?.message || String(err),
      requestId,
    });
    return res.status(500).json({ error: 'Erro ao carregar histórico' });
  }
}

/**
 * POST /api/platform/tenants/:id/features/revert/:auditId
 * Restaura `previous_flags` da linha de auditoria como novo mapa de overrides (plano + override).
 */
export async function postRevertTenantFeaturesHandler(req, res) {
  const requestId = req.requestId ?? null;
  const tenantId = String(req.params.id || '').trim();
  const auditId = String(req.params.auditId || '').trim();
  const updatedBy = changedByFromRequest(req);

  log.info({
    event: 'TENANT_FEATURE_FLAGS_REVERT_REQUESTED',
    context: 'platform',
    tenantId: tenantId || null,
    auditId: auditId || null,
    updatedBy,
    requestId,
  });

  if (!tenantId || !auditId) {
    log.warn({
      event: 'TENANT_FEATURE_FLAGS_REVERT_FAILED',
      context: 'platform',
      tenantId: tenantId || null,
      auditId: auditId || null,
      updatedBy,
      requestId,
      reason: 'invalid_params',
    });
    return res.status(400).json({ error: 'Parâmetros inválidos' });
  }

  try {
    const tenant = await getTenantById(tenantId);
    if (!tenant) {
      log.warn({
        event: 'TENANT_FEATURE_FLAGS_REVERT_FAILED',
        context: 'platform',
        tenantId,
        auditId,
        updatedBy,
        requestId,
        reason: 'tenant_not_found',
      });
      return res.status(404).json({ error: 'Tenant não encontrado' });
    }

    const auditRow = await getTenantFeatureFlagAuditById(tenantId, auditId);
    if (!auditRow) {
      log.warn({
        event: 'TENANT_FEATURE_FLAGS_REVERT_FAILED',
        context: 'platform',
        tenantId,
        auditId,
        updatedBy,
        requestId,
        reason: 'audit_not_found',
      });
      return res.status(404).json({ error: 'Registro de auditoria não encontrado' });
    }

    const planBase = getBaseFeaturesForPlan(tenant.plan);
    const fromHistory = validateTenantFeatureFlags(auditRow.previous_flags);
    const newStored = normalizeSparseOverrides(fromHistory, planBase);

    const previousStored = validateTenantFeatureFlags(tenant.feature_flags);
    const effectivePreviousFlags = { ...computeFeaturesForTenantRow(tenant) };
    const noop = sparseOverrideMapsEqual(previousStored, newStored);

    if (noop) {
      log.info({
        event: 'TENANT_FEATURE_FLAGS_REVERTED',
        context: 'platform',
        tenantId,
        auditId,
        updatedBy,
        requestId,
        noop: true,
      });
      return res.status(200).json({
        ok: true,
        noop: true,
        message: 'Nenhuma alteração aplicada',
        feature_flags: previousStored,
        effective_feature_flags: effectivePreviousFlags,
      });
    }

    const { effectiveNewFlags } = await withTenantFeatureFlagsTransaction({
      operation: 'revert_features',
      tenantId,
      auditId,
      requestId,
      exec: async (client) => {
        const updatedRow = await updateTenantFeatureFlags(tenantId, newStored, client);
        const computed = { ...computeFeaturesForTenantRow(updatedRow) };
        const inserted = await insertTenantFeatureFlagAudit(
          {
            tenantId,
            changedBy: updatedBy,
            previousFlags: previousStored,
            newFlags: newStored,
            effectivePreviousFlags,
            effectiveNewFlags: computed,
          },
          client,
        );
        return { effectiveNewFlags: computed, auditRowId: inserted?.id ?? null };
      },
    });

    log.info({
      event: 'TENANT_FEATURE_FLAGS_REVERTED',
      context: 'platform',
      tenantId,
      auditId,
      updatedBy,
      requestId,
      noop: false,
    });

    invalidateTenantLimitsCache(tenantId);

    return res.status(200).json({
      ok: true,
      noop: false,
      feature_flags: newStored,
      effective_feature_flags: effectiveNewFlags,
    });
  } catch (err) {
    log.error({
      event: 'TENANT_FEATURE_FLAGS_REVERT_FAILED',
      context: 'platform',
      tenantId,
      auditId,
      updatedBy,
      requestId,
      reason: 'exception',
      error: err?.message || String(err),
    });
    return res.status(500).json({ error: 'Erro ao reverter feature flags' });
  }
}

/**
 * GET /api/platform/feature-templates
 */
export async function getFeatureTemplatesHandler(_req, res) {
  try {
    return res.status(200).json({ items: listFeatureTemplatesForApi() });
  } catch (err) {
    log.error({
      event: 'TENANT_FEATURE_TEMPLATES_LIST_FAILED',
      context: 'platform',
      error: err?.message || String(err),
    });
    return res.status(500).json({ error: 'Erro ao listar templates' });
  }
}

/**
 * POST /api/platform/tenants/:id/features/apply-template
 * Body: { templateKey: string }
 */
export async function postApplyFeatureTemplateHandler(req, res) {
  const requestId = req.requestId ?? null;
  try {
    const tenantId = String(req.params.id || '').trim();
    if (!tenantId) {
      return res.status(400).json({ error: 'ID inválido' });
    }

    const body = req.body;
    const templateKey = String(body?.templateKey ?? '').trim();
    if (!templateKey) {
      return res.status(400).json({ error: 'templateKey é obrigatório' });
    }

    const tenant = await getTenantById(tenantId);
    if (!tenant) {
      return res.status(404).json({ error: 'Tenant não encontrado' });
    }

    const tpl = getFeatureTemplateByKey(templateKey);
    if (!tpl) {
      return res.status(404).json({ error: 'Template não encontrado' });
    }

    const planBase = getBaseFeaturesForPlan(tenant.plan);
    const validatedTemplate = validateTenantFeatureFlags(tpl.flags);
    const newStored = normalizeSparseOverrides(validatedTemplate, planBase);

    const previousStored = validateTenantFeatureFlags(tenant.feature_flags);
    const effectivePreviousFlags = { ...computeFeaturesForTenantRow(tenant) };
    const previousFlags = { ...effectivePreviousFlags };

    const updatedBy = changedByFromRequest(req);

    const { newFlags, auditRow } = await withTenantFeatureFlagsTransaction({
      operation: 'apply_template',
      tenantId,
      auditId: null,
      requestId,
      exec: async (client) => {
        const updatedRow = await updateTenantFeatureFlags(tenantId, newStored, client);
        const computed = { ...computeFeaturesForTenantRow(updatedRow) };
        const row = await insertTenantFeatureFlagAudit(
          {
            tenantId,
            changedBy: updatedBy,
            previousFlags: previousStored,
            newFlags: newStored,
            effectivePreviousFlags,
            effectiveNewFlags: computed,
          },
          client,
        );
        return { newFlags: computed, auditRow: row, auditRowId: row?.id ?? null };
      },
    });

    log.info({
      event: 'TENANT_FEATURE_FLAGS_UPDATED',
      context: 'platform',
      tenantId,
      previousFlags,
      newFlags,
      updatedBy,
      requestId,
    });

    log.info({
      event: 'TENANT_FEATURE_TEMPLATE_APPLIED',
      context: 'platform',
      tenantId,
      templateKey,
      auditId: auditRow?.id ?? null,
      updatedBy,
      requestId,
    });

    if (auditRow?.id) {
      log.info({
        event: 'TENANT_FEATURE_FLAGS_AUDIT_CREATED',
        context: 'platform',
        tenantId,
        auditId: auditRow.id,
        updatedBy,
        requestId,
      });
    }

    invalidateTenantLimitsCache(tenantId);

    return res.status(200).json({
      tenant_id: tenantId,
      template_key: templateKey,
      feature_flags: newStored,
      effective_feature_flags: newFlags,
    });
  } catch (err) {
    log.error({
      event: 'TENANT_FEATURE_TEMPLATE_APPLY_FAILED',
      context: 'platform',
      tenantId: String(req.params.id || '').trim() || null,
      error: err?.message || String(err),
      requestId,
    });
    return res.status(500).json({ error: 'Erro ao aplicar template' });
  }
}
