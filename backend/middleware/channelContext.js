/**
 * Middleware global: channelContext (OBRIGATÓRIO).
 * Ordem: 1) query ?channel=  2) header x-channel  3) fallback WEB
 * Normaliza canal (uppercase). Valida contra lista permitida; inválido → WEB.
 * Log em TODA request: [Canal ativo: X] METHOD /rota
 */

const DEFAULT_CHANNEL = 'WEB';
const CANAIS_PERMITIDOS = ['web', 'api', 'whatsapp', 'instagram'];

function normalizeChannel(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  return v || null;
}

function validateChannel(channel) {
  const lower = channel.toLowerCase();
  return CANAIS_PERMITIDOS.includes(lower) ? lower.toUpperCase() : DEFAULT_CHANNEL;
}

export function channelContext(req, res, next) {
  const fromQuery = normalizeChannel(req.query?.channel);
  const fromHeader = normalizeChannel(req.headers?.['x-channel']);
  const raw = fromQuery ?? fromHeader ?? 'web';
  const channel = validateChannel(raw);

  const clientId = req.query?.client_id ?? req.body?.client_id ?? req.headers?.['x-client-id'] ?? null;
  const agentId = req.query?.agent_id ?? req.body?.agent_id ?? req.headers?.['x-agent-id'] ?? null;

  req.context = {
    channel,
    client_id: clientId ?? null,
    agent_id: agentId ?? null,
  };

  console.log(`[Canal ativo: ${channel}] ${req.method} ${req.path}`);
  next();
}

/**
 * Middleware: define header x-channel-active em todas as respostas /api.
 */
export function setChannelActiveHeader(req, res, next) {
  const channel = req.context?.channel ?? DEFAULT_CHANNEL;
  res.set('x-channel-active', channel);
  next();
}
