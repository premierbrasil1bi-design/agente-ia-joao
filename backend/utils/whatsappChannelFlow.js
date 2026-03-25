/**
 * Estados do fluxo SaaS WhatsApp (armazenados em channels.config.whatsapp).
 * Canais antigos sem config.whatsapp.phase continuam válidos (derivamos fase legada).
 */

export const WHATSAPP_PHASE = {
  DRAFT: 'draft',
  PROVISIONING: 'provisioning',
  AWAITING_CONNECTION: 'awaiting_connection',
  CONNECTED: 'connected',
  ERROR: 'error',
};

/** @param {object | string | null | undefined} config */
export function parseChannelConfig(config) {
  if (config == null) return {};
  if (typeof config === 'string') {
    try {
      return JSON.parse(config);
    } catch {
      return {};
    }
  }
  if (typeof config === 'object') return { ...config };
  return {};
}

export function getWhatsappFlow(config) {
  const c = parseChannelConfig(config);
  return c.whatsapp && typeof c.whatsapp === 'object' ? { ...c.whatsapp } : {};
}

/**
 * @param {object | string | null} config
 * @param {object} patch — campos parciais em whatsapp (phase, lastConnectAt, userMessage, etc.)
 */
export function mergeWhatsappConfig(config, patch) {
  const c = parseChannelConfig(config);
  const prev = getWhatsappFlow(c);
  return {
    ...c,
    whatsapp: {
      ...prev,
      ...patch,
    },
  };
}

/**
 * Fase pública para API/UI.
 * Prioriza `channel.connection_status` (fonte de verdade); `status`/`evolution_status` são fallback legado.
 * @param {object} channel — row do repositório
 */
export function deriveFlowPhase(channel) {
  const type = String(channel?.type || '').toLowerCase();
  if (type !== 'whatsapp') return null;

  const flow = getWhatsappFlow(channel.config);
  if (flow.phase && Object.values(WHATSAPP_PHASE).includes(flow.phase)) {
    return flow.phase;
  }

  const ext = channel.external_id != null ? String(channel.external_id).trim() : '';
  if (!ext) return WHATSAPP_PHASE.DRAFT;

  const cs = String(channel.connection_status || '').toLowerCase();
  if (cs === 'connected') return WHATSAPP_PHASE.CONNECTED;
  if (cs === 'error') return WHATSAPP_PHASE.ERROR;
  if (cs === 'connecting') return WHATSAPP_PHASE.AWAITING_CONNECTION;

  const ev = String(channel.evolution_status || '').toLowerCase();
  const st = String(channel.status || '').toLowerCase();
  if (st === 'active' || ev === 'open' || ev === 'connected') return WHATSAPP_PHASE.CONNECTED;
  if (ev === 'connecting' || ev === 'qr') return WHATSAPP_PHASE.AWAITING_CONNECTION;

  return WHATSAPP_PHASE.AWAITING_CONNECTION;
}

export function nextActionForPhase(phase) {
  switch (phase) {
    case WHATSAPP_PHASE.DRAFT:
      return 'provision_instance';
    case WHATSAPP_PHASE.PROVISIONING:
      return 'wait';
    case WHATSAPP_PHASE.AWAITING_CONNECTION:
      return 'connect';
    case WHATSAPP_PHASE.CONNECTED:
      return null;
    case WHATSAPP_PHASE.ERROR:
      return 'provision_instance';
    default:
      return 'provision_instance';
  }
}

/**
 * Próxima ação da UI/orquestração (considera connect já disparado → só polling de artefato).
 * @param {object} channel — row do repositório
 */
export function nextActionForChannel(channel) {
  const phase = deriveFlowPhase(channel);
  if (phase === WHATSAPP_PHASE.PROVISIONING) return 'wait';
  if (phase === WHATSAPP_PHASE.ERROR) return 'provision_instance';
  if (phase === WHATSAPP_PHASE.DRAFT) return 'provision_instance';
  if (phase === WHATSAPP_PHASE.CONNECTED) return null;
  if (phase === WHATSAPP_PHASE.AWAITING_CONNECTION) {
    const flow = getWhatsappFlow(channel.config);
    if (flow.lastConnectAt) return 'poll_connection_artifact';
    return 'connect';
  }
  return 'provision_instance';
}

/** Cooldown entre connects automáticos (ms). */
export const CONNECT_COOLDOWN_MS = parseInt(process.env.WHATSAPP_CONNECT_COOLDOWN_MS || '45000', 10);

export function canAutoConnect(flow, now = Date.now()) {
  const last = flow.lastConnectAt;
  if (!last) return true;
  const t = new Date(last).getTime();
  if (Number.isNaN(t)) return true;
  return now - t >= CONNECT_COOLDOWN_MS;
}

