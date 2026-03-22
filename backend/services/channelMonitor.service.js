/**
 * Monitor de instâncias Evolution: verifica estado periodicamente (60s),
 * atualiza status no banco e tenta reconexão automática quando close e channel.active === true.
 */

import { pool } from '../db/pool.js';
import * as evolutionService from './evolutionService.js';
import * as channelRepo from '../repositories/channel.repository.js';
import { normalizeEvolutionState } from '../utils/evolutionState.js';
import { mapEvolutionStatus, toEvolutionStatusColumn } from '../utils/mapEvolutionStatus.js';
import { logger } from '../utils/logger.js';

const INTERVAL_MS = 60 * 1000;

let intervalId = null;

/**
 * Busca canais com provider = evolution e external_id preenchido (sem alterar repositório).
 */
async function getEvolutionChannels() {
  const { rows } = await pool.query(
    `SELECT id, tenant_id, agent_id, type, instance, is_active AS active,
            provider, external_id, status
     FROM channels
     WHERE provider = 'evolution' AND external_id IS NOT NULL AND external_id != ''`
  );
  return rows;
}

/**
 * Uma rodada do monitor: verifica estado de cada instância e atualiza banco; reconecta se close e active.
 */
export async function runMonitorCycle() {
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
      const dbStatus = mapEvolutionStatus(rawState);
      console.log('[channels] status normalized:', rawState, '→', dbStatus);

      const previousStatus = ch.status ?? null;
      if (dbStatus !== previousStatus) {
        logger.statusChange(instanceName, ch.id, previousStatus, normalizedStatus);
      }

      await channelRepo.updateConnection(ch.id, ch.tenant_id, {
        status: dbStatus,
        evolution_status: toEvolutionStatusColumn(rawState),
        ...(dbStatus === 'active' ? { connected_at: new Date(), last_error: null } : {}),
      });

      if (normalizedStatus === 'disconnected' && ch.active === true) {
        try {
          await evolutionService.connectInstance(instanceName);
          logger.reconnect(instanceName, ch.id);
          const connectingDb = mapEvolutionStatus('connecting');
          console.log('[channels] status normalized:', 'connecting', '→', connectingDb);
          await channelRepo.updateConnection(ch.id, ch.tenant_id, {
            status: connectingDb,
            evolution_status: 'connecting',
          });
        } catch (reconnectErr) {
          logger.apiError('reconnect', instanceName, reconnectErr.message);
        }
      }
    } catch (err) {
      logger.apiError('getConnectionStatus', instanceName, err.message);
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
