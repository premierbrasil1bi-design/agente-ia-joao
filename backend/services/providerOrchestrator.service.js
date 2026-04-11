import { getProvider } from '../providers/index.js';
import { mergeProviderConfigForConnect, resolveProvider } from '../providers/provider.factory.js';
import {
  getTenantById,
  refreshTenantAfterBillingCycleCheck,
  tryConsumeTenantMessageQuota,
  refundTenantMessageQuota,
} from '../repositories/tenant.repository.js';
import { BILLING_CYCLE_DAYS } from './tenantMessageLimit.service.js';
import { getEffectiveProvidersForTenant } from './providerPlanAccess.service.js';
import { assertCanSendMessage, TenantPlanLimitBlockedError } from './tenantLimitsGuard.js';
import { log } from '../utils/logger.js';
import {
  logTenantMessageUsageAsync,
  extractProviderMessageIdForAudit,
} from '../repositories/tenantMessageUsageLog.repository.js';

const RETRY_DELAYS_MS = [500, 1500, 3000];
const MAX_ATTEMPTS = 3;
const UNHEALTHY_COOLDOWN_MS = 10 * 60 * 1000;

export const providerHealthStore = {};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeProviderList(channel) {
  const primary = String(resolveProvider(channel) || '').toLowerCase().trim();
  const fallbacks = Array.isArray(channel?.fallback_providers)
    ? channel.fallback_providers.map((p) => String(p || '').toLowerCase().trim()).filter(Boolean)
    : [];
  return [...new Set([primary, ...fallbacks].filter(Boolean))];
}

function getHealth(providerName) {
  const key = String(providerName || '').toLowerCase().trim();
  if (!providerHealthStore[key]) {
    providerHealthStore[key] = {
      success: 0,
      failure: 0,
      total: 0,
      lastFailureAt: null,
    };
  }
  return providerHealthStore[key];
}

function markSuccess(providerName) {
  const h = getHealth(providerName);
  h.success += 1;
  h.total += 1;
}

function markFailure(providerName) {
  const h = getHealth(providerName);
  h.failure += 1;
  h.total += 1;
  h.lastFailureAt = new Date().toISOString();
}

function isProviderUnhealthy(providerName) {
  const h = getHealth(providerName);
  if (h.total < 5) return false;
  const failureRate = h.failure / Math.max(1, h.total);
  const recentFailure =
    h.lastFailureAt && Date.now() - new Date(h.lastFailureAt).getTime() < UNHEALTHY_COOLDOWN_MS;
  return recentFailure && failureRate >= 0.7;
}

export function getProviderHealthSnapshot() {
  const snapshot = {};
  for (const [provider, values] of Object.entries(providerHealthStore || {})) {
    const total = Number(values?.total || 0);
    const failure = Number(values?.failure || 0);
    const failureRate = total > 0 ? failure / total : 0;
    snapshot[provider] = {
      success: Number(values?.success || 0),
      failure,
      total,
      lastFailureAt: values?.lastFailureAt || null,
      failureRate,
      unhealthy: isProviderUnhealthy(provider),
    };
  }
  return snapshot;
}

function buildChannelForProvider(channel, providerName) {
  const cfg = channel?.provider_config && typeof channel.provider_config === 'object' ? channel.provider_config : {};
  return {
    ...channel,
    provider: providerName,
    provider_config: { ...cfg, type: providerName },
  };
}

async function trySendWithRetry(providerName, providerInstance, payload) {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await providerInstance.sendMessage(payload);
    } catch (err) {
      lastError = err;
      if (attempt < MAX_ATTEMPTS) {
        const delay = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)];
        await sleep(delay);
      }
    }
  }
  throw lastError || new Error(`Falha no envio (${providerName})`);
}

export async function sendMessageWithFallback(channel, payload) {
  const providers = normalizeProviderList(channel);
  if (providers.length === 0) throw new Error('Nenhum provider configurado para o canal.');
  let tenant = channel?.tenant_id ? await getTenantById(channel.tenant_id) : null;
  if (tenant && channel?.tenant_id) {
    tenant = await refreshTenantAfterBillingCycleCheck(channel.tenant_id, BILLING_CYCLE_DAYS);
  }

  if (channel?.tenant_id) {
    try {
      await assertCanSendMessage(channel.tenant_id);
    } catch (e) {
      if (e instanceof TenantPlanLimitBlockedError) {
        log.warn({
          event: 'TENANT_LIMIT_BLOCKED',
          context: 'orchestrator',
          tenantId: channel.tenant_id,
          metadata: { check: 'assertCanSendMessage', reason: e.reason },
        });
        const err = new Error(e.message || 'Limite do plano atingido');
        err.code = 'TENANT_PLAN_LIMIT';
        err.reason = e.reason;
        err.httpStatus = 429;
        throw err;
      }
      throw e;
    }
  }

  const effective = tenant ? getEffectiveProvidersForTenant(tenant) : [];
  const allowedSet = new Set(effective);
  const providersFiltered = tenant
    ? providers.filter((p) => allowedSet.has(String(p || '').toLowerCase().trim()))
    : providers;
  if (providersFiltered.length === 0) {
    const e = new Error('Nenhum provider permitido disponível para este tenant/plano.');
    e.code = 'NO_ALLOWED_PROVIDER_AVAILABLE';
    e.httpStatus = 403;
    e.details = {
      tried: [],
      requestedProvider: providers[0] || null,
      fallbackProviders: providers.slice(1),
      allowedProviders: effective,
    };
    throw e;
  }

  let quotaConsumed = false;
  if (channel?.tenant_id) {
    const consumed = await tryConsumeTenantMessageQuota(channel.tenant_id);
    if (!consumed) {
      const t = await getTenantById(channel.tenant_id);
      if (!t) {
        throw new Error('Tenant não encontrado para consumo de quota.');
      }
      const max = Number(t.max_messages ?? 0);
      const used = Math.max(0, Number(t.messages_used_current_period ?? 0));
      log.warn({
        event: 'TENANT_LIMIT_BLOCKED',
        context: 'orchestrator',
        tenantId: channel.tenant_id,
        metadata: { check: 'tryConsumeTenantMessageQuota', max_messages: max, used },
      });
      const e = new Error('Limite de mensagens do período excedido para este tenant.');
      e.code = 'TENANT_PLAN_LIMIT';
      e.reason = 'Cota de mensagens do período esgotada';
      e.httpStatus = 429;
      e.details = {
        max_messages: max,
        messages_used_current_period: used,
      };
      throw e;
    }
    quotaConsumed = true;
    console.info('[ORCHESTRATOR] tenant message quota consumed', {
      tenantId: channel.tenant_id,
      max_messages: consumed.max_messages,
      messages_used_current_period: consumed.messages_used_current_period,
    });
    logTenantMessageUsageAsync({
      tenantId: channel.tenant_id,
      eventType: 'consume',
      provider: null,
      messageId: null,
    });
  }

  const errors = [];
  for (const providerName of providersFiltered) {
    if (isProviderUnhealthy(providerName)) {
      console.warn('[ORCHESTRATOR] provider skipped (unhealthy)', { provider: providerName });
      continue;
    }

    try {
      console.info('[ORCHESTRATOR] trying provider', providerName);
      const ch = buildChannelForProvider(channel, providerName);
      const config = mergeProviderConfigForConnect(ch);
      const provider = getProvider(providerName, config);
      const out = await trySendWithRetry(providerName, provider, payload);
      markSuccess(providerName);
      if (providerName !== providersFiltered[0]) {
        console.info('[ORCHESTRATOR] fallback to', providerName);
      }
      console.info('[ORCHESTRATOR] success via', providerName);
      if (channel?.tenant_id) {
        logTenantMessageUsageAsync({
          tenantId: channel.tenant_id,
          eventType: 'success',
          provider: providerName,
          messageId: extractProviderMessageIdForAudit(out),
        });
      }
      return { providerUsed: providerName, data: out };
    } catch (err) {
      markFailure(providerName);
      errors.push({ provider: providerName, message: err?.message || String(err) });
    }
  }

  if (quotaConsumed && channel?.tenant_id) {
    try {
      await refundTenantMessageQuota(channel.tenant_id);
      console.info('[ORCHESTRATOR] tenant message quota refunded after send failure', { tenantId: channel.tenant_id });
      logTenantMessageUsageAsync({
        tenantId: channel.tenant_id,
        eventType: 'refund',
        provider: null,
        messageId: null,
      });
    } catch (refundErr) {
      console.error('[ORCHESTRATOR] refund tenant message quota failed', refundErr?.message || refundErr);
    }
  }

  console.error('[ORCHESTRATOR] all providers failed', { errors });
  const e = new Error('Falha no envio em todos os providers.');
  e.code = 'ALL_PROVIDERS_FAILED';
  e.details = {
    tried: providersFiltered,
    errors,
    requestedProvider: providers[0] || null,
    fallbackProviders: providers.slice(1),
    allowedProviders: tenant ? getEffectiveProvidersForTenant(tenant) : providersFiltered,
  };
  throw e;
}

