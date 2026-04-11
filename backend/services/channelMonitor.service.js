/**
 * Monitor de instâncias Evolution: sync com listagem (60s), estado por instância,
 * reconexão automática quando close e channel.active === true.
 */

import { pool } from '../db/pool.js';
import * as evolutionService from './evolutionService.js';
import { syncInstancesWithDatabase } from './evolutionProxyService.js';
import { normalizeEvolutionState } from '../utils/evolutionState.js';
import { dualStatusFromEvolutionRaw } from '../utils/mapConnectionLifecycle.js';
import {
  CONNECTION,
  transitionEvolutionChannelConnection,
} from './channelEvolutionState.service.js';
import { logger } from '../utils/logger.js';
import { validateProviderAccessForTenant } from './providerAccess.service.js';
import { hasTenantFeature } from './tenantFeatures.service.js';

const INTERVAL_MS = 60 * 1000;

let intervalId = null;

/**
 * Busca canais com provider = evolution e external_id preenchido.
 */
async function getEvolutionChannels() {
  const { rows } = await pool.query(
    `SELECT id, tenant_id, agent_id, type, instance, is_active AS active,
            provider, external_id, status, connection_status
     FROM channels
     WHERE provider = 'evolution' AND external_id IS NOT NULL AND external_id != ''`
  );
  return rows;
}

/**
 * Uma rodada: sync listagem + estado por instância; reconecta se close e active.
 */
export async function runMonitorCycle() {
  const evoUrl = (process.env.EVOLUTION_API_URL || process.env.EVOLUTION_URL || '').trim();
  if (evoUrl) {
    try {
      await syncInstancesWithDatabase();
    } catch (e) {
      console.warn('[EVOLUTION] syncInstancesWithDatabase (monitor):', e.message);
    }
  }

  let channels;
  try {
    channels = await getEvolutionChannels();
  } catch (err) {
    logger.apiError('runMonitorCycle', null, err.message);
    return;
  }

  for (const ch of channels || []) {
    const instanceName = ch.external_id;
    if (!instanceName) continue;

    try {
      const state = await evolutionService.getConnectionStatus(instanceName);
      const rawState = state?.state ?? state?.instance?.state ?? null;
      const normalizedStatus = normalizeEvolutionState(rawState);
      const { connection_status, status: legacyPreview } = dualStatusFromEvolutionRaw(rawState);

      const previousLegacy = ch.status ?? null;
      if (legacyPreview !== previousLegacy) {
        logger.statusChange(instanceName, ch.id, previousLegacy, normalizedStatus);
      }

      await transitionEvolutionChannelConnection({
        channelId: ch.id,
        tenantId: ch.tenant_id,
        channelRow: ch,
        nextConnectionStatus: connection_status,
        evolutionRaw: rawState,
        reason: 'poll: GET connectionState',
        source: 'poll',
        trustRemoteState: true,
      });

      if (normalizedStatus === 'disconnected' && ch.active === true) {
        const healOk = await hasTenantFeature(ch.tenant_id, 'autoHealing');
        if (!healOk) {
          console.warn(
            '[EVOLUTION] auto-reconnect ignorado (autoHealing desligado no plano) channel=%s tenant=%s',
            ch.id,
            ch.tenant_id,
          );
          continue;
        }
        try {
          await validateProviderAccessForTenant(ch.tenant_id, ch.provider);
        } catch {
          console.warn(
            '[EVOLUTION] auto-reconnect ignorado (provider não permitido no plano) channel=%s tenant=%s',
            ch.id,
            ch.tenant_id,
          );
          continue;
        }
        try {
          await evolutionService.connectInstance(instanceName);
          logger.reconnect(instanceName, ch.id);
          console.log('[EVOLUTION] monitor auto-reconnect instance=%s channel=%s', instanceName, ch.id);
          await transitionEvolutionChannelConnection({
            channelId: ch.id,
            tenantId: ch.tenant_id,
            channelRow: null,
            nextConnectionStatus: CONNECTION.CONNECTING,
            evolutionRaw: 'connecting',
            reason: 'poll: auto-reconnect disparado após estado close + canal ativo',
            source: 'poll',
          });
        } catch (reconnectErr) {
          logger.apiError('reconnect', instanceName, reconnectErr.message);
          console.warn('[EVOLUTION] falha reconexão instance=%s err=%s', instanceName, reconnectErr.message);
        }
      }
    } catch (err) {
      const ax = err.response?.status;
      logger.apiError('getConnectionStatus', instanceName, err.message);
      console.warn('[EVOLUTION] getConnectionStatus instance=%s err=%s', instanceName, err.message);

      if (ax === 404) {
        await transitionEvolutionChannelConnection({
          channelId: ch.id,
          tenantId: ch.tenant_id,
          channelRow: ch,
          nextConnectionStatus: CONNECTION.ERROR,
          evolutionRaw: 'http_404',
          reason: 'poll: connectionState HTTP 404 (instância inexistente na Evolution)',
          source: 'poll',
          trustRemoteState: true,
          patch: { last_error: 'Evolution retornou 404 para esta instância.' },
        });
      }
    }
  }
}

/**
 * Inicia o monitor (intervalo 60s). Idempotente.
 */
export function startChannelMonitor() {
  if (intervalId != null) return;
  runMonitorCycle();
  intervalId = setInterval(runMonitorCycle, INTERVAL_MS);
}

/**
 * Para o monitor.
 */
export function stopChannelMonitor() {
  if (intervalId != null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
