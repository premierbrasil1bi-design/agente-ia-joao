/**
 * Provisionamento lógico para canais WhatsApp com provider WAHA (sem criar sessão remota até o "Conectar").
 * Reutiliza nome estável igual ao fluxo Evolution para consistência em external_id.
 */

import * as channelRepo from '../repositories/channel.repository.js';
import { generateEvolutionInstanceName } from './evolutionProvision.service.js';
import {
  WHATSAPP_PHASE,
  mergeWhatsappConfig,
  deriveFlowPhase,
} from '../utils/whatsappChannelFlow.js';
import {
  CONNECTION,
  transitionEvolutionChannelConnection,
} from './channelEvolutionState.service.js';
import * as wahaService from './wahaService.js';

/** @type {Map<string, Promise<object>>} */
const locks = new Map();

function lockKey(tenantId, channelId) {
  return `${tenantId}:${channelId}`;
}

/**
 * Garante external_id (nome de sessão WAHA) e fase aguardando conexão.
 * @returns {Promise<{ ok: boolean, channel?: object, skipped?: boolean, reason?: string, error?: string }>}
 */
export async function provisionWhatsAppInstance(channelId, tenantId) {
  const key = lockKey(tenantId, channelId);
  const existing = locks.get(key);
  if (existing) return existing;

  const run = (async () => {
    try {
      return await runOnce(channelId, tenantId);
    } finally {
      locks.delete(key);
    }
  })();

  locks.set(key, run);
  return run;
}

async function runOnce(channelId, tenantId) {
  const channel = await channelRepo.findById(channelId, tenantId);
  if (!channel) {
    return { ok: false, error: 'Canal não encontrado.', technical: 'CHANNEL_NOT_FOUND' };
  }

  if (String(channel.type || '').toLowerCase() !== 'whatsapp') {
    return { ok: false, error: 'Provisionamento só se aplica a canais WhatsApp.', technical: 'NOT_WHATSAPP' };
  }

  const prov = String(channel.provider || '').toLowerCase();
  const typeFromCfg = String(channel.provider_config?.type || '').toLowerCase();
  if (prov !== 'waha' && typeFromCfg !== 'waha') {
    return { ok: false, error: 'Canal não é WAHA.', technical: 'NOT_WAHA' };
  }

  const derived = deriveFlowPhase(channel);
  if (derived === WHATSAPP_PHASE.CONNECTED) {
    return { ok: true, channel, skipped: true, reason: 'already_connected' };
  }

  const ext = wahaService.resolveWahaSessionName(channel);

  const cfg = mergeWhatsappConfig(channel.config, {
    phase: WHATSAPP_PHASE.AWAITING_CONNECTION,
    userMessage: null,
    provisioningStartedAt: null,
  });

  const tr = await transitionEvolutionChannelConnection({
    channelId,
    tenantId,
    channelRow: channel,
    nextConnectionStatus: CONNECTION.CONNECTING,
    evolutionRaw: 'waha_provision',
    reason: 'provision WAHA: nome de sessão reservado — use Conectar para criar sessão no WAHA',
    source: 'provision',
    patch: {
      provider: 'waha',
      external_id: ext,
      instance: channel.instance || ext,
      config: cfg,
      last_error: null,
    },
  });

  return { ok: true, channel: tr.channel ?? (await channelRepo.findById(channelId, tenantId)) };
}
