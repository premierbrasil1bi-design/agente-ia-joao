/**
 * Gateway interno para a Evolution API — injeta apikey a partir de variáveis de ambiente.
 * Rotas HTTP devem usar este serviço (ou evolutionService/fila); não expor a chave ao frontend.
 */

import { pool } from '../db/pool.js';
import * as evolutionHttp from './evolutionHttp.client.js';
import {
  collectInstanceNamesFromFetch,
  extractInstanceStatesFromFetch,
} from './channelConnection.service.js';
import { dualStatusFromEvolutionRaw } from '../utils/mapConnectionLifecycle.js';
import {
  CONNECTION,
  normalizeConnectionStatus,
  transitionEvolutionChannelConnection,
} from './channelEvolutionState.service.js';

export function assertEvolutionConfigured() {
  const url = (process.env.EVOLUTION_API_URL || process.env.EVOLUTION_URL || '').trim();
  if (!url) {
    const err = new Error('EVOLUTION_API_URL não configurada.');
    err.code = 'EVOLUTION_NOT_CONFIGURED';
    throw err;
  }
  evolutionHttp.getEvolutionApiKey();
}

function assertConfigured() {
  assertEvolutionConfigured();
}

/**
 * Cruza instâncias retornadas pela Evolution com channels (provider evolution).
 * Ausência na listagem não implica erro: só desconecta se antes estava conectado.
 * Estado vindo do payload da listagem aplica-se com trustRemoteState.
 */
export async function syncInstancesWithDatabase() {
  assertConfigured();
  const data = await evolutionHttp.fetchInstances();
  const names = collectInstanceNamesFromFetch(data);
  const states = extractInstanceStatesFromFetch(data);

  const { rows } = await pool.query(
    `SELECT id, tenant_id, external_id, connection_status, status FROM channels
     WHERE provider = 'evolution' AND external_id IS NOT NULL AND TRIM(external_id) <> ''`
  );

  let rowsUpdated = 0;
  for (const ch of rows) {
    const ext = String(ch.external_id).trim();
    if (!names.has(ext)) {
      const prevConn = normalizeConnectionStatus(ch.connection_status);
      const wasConnected =
        prevConn === CONNECTION.CONNECTED || String(ch.status || '').toLowerCase() === 'active';
      if (wasConnected) {
        await transitionEvolutionChannelConnection({
          channelId: ch.id,
          tenantId: ch.tenant_id,
          channelRow: ch,
          nextConnectionStatus: CONNECTION.DISCONNECTED,
          evolutionRaw: 'missing_from_list',
          reason:
            'sync: instância ausente em fetchInstances; canal estava conectado → disconnected',
          source: 'sync',
          trustRemoteState: true,
          patch: { last_error: null },
        });
        rowsUpdated += 1;
      } else {
        console.log(
          '[EVOLUTION] sync omitido (instância fora da lista, canal não estava conectado) channel=%s instance=%s connection_status=%s',
          ch.id,
          ext,
          prevConn
        );
      }
      continue;
    }
    const raw = states.get(ext);
    if (raw != null) {
      const { connection_status } = dualStatusFromEvolutionRaw(raw);
      const r = await transitionEvolutionChannelConnection({
        channelId: ch.id,
        tenantId: ch.tenant_id,
        channelRow: ch,
        nextConnectionStatus: connection_status,
        evolutionRaw: raw,
        reason: 'sync: estado presente no payload de fetchInstances',
        source: 'sync',
        trustRemoteState: true,
      });
      if (r.applied) rowsUpdated += 1;
    }
  }

  console.log(
    '[EVOLUTION] syncInstancesWithDatabase channels=%s evolutionInstances=%s updated=%s',
    rows.length,
    names.size,
    rowsUpdated
  );
  return { channels: rows.length, evolutionInstances: names.size, rowsUpdated };
}

export async function fetchInstances() {
  assertConfigured();
  console.log('[EVOLUTION] fetchInstances (proxy)');
  return evolutionHttp.fetchInstances();
}

/**
 * Cria instância na Evolution (POST /instance/create).
 * Aceita body completo ou apenas { instanceName } / { name }.
 */
export async function createInstance(payload = {}) {
  assertConfigured();
  const body = typeof payload === 'object' && payload !== null ? { ...payload } : {};
  const name = body.instanceName ?? body.name;
  if (!name || String(name).trim() === '') {
    const err = new Error('instanceName (ou name) é obrigatório.');
    err.code = 'VALIDATION';
    throw err;
  }
  console.log('[EVOLUTION] createInstance name=%s', String(name).trim());
  return evolutionHttp.createInstance(String(name).trim());
}

export async function getQRCode(instanceName) {
  assertConfigured();
  const n = String(instanceName ?? '').trim();
  if (!n) {
    const err = new Error('instance é obrigatório.');
    err.code = 'VALIDATION';
    throw err;
  }
  console.log('[EVOLUTION] getQRCode instance=%s', n);
  return evolutionHttp.getQRCode(n);
}
