/**
 * Resolução de headers de autenticação para providers WhatsApp (WAHA, Evolution, Z-API).
 * WAHA: usa chave fixa via `X-Api-Key`.
 */

const WAHA_BASE = (
  process.env.WAHA_API_URL ||
  process.env.WAHA_URL ||
  process.env.WAHA_BASE_URL ||
  ''
)
  .trim()
  .replace(/\/$/, '');

const WAHA_API_KEY = (process.env.WAHA_API_KEY || '').trim();

let cache = {
  waha: {
    mode: 'x_api_key',
    key: WAHA_API_KEY,
  },
};

function evolutionKeyFromEnv() {
  const url = (process.env.EVOLUTION_API_URL || process.env.EVOLUTION_URL || '').trim();
  const key =
    url !== ''
      ? (process.env.EVOLUTION_API_KEY || '').trim()
      : (process.env.EVOLUTION_API_KEY || process.env.AUTHENTICATION_API_KEY || '').trim();
  return key || '';
}

function staticProviderHeaders(provider) {
  const p = String(provider || '').toLowerCase().trim();
  if (p === 'evolution') {
    const key = evolutionKeyFromEnv();
    return key ? { apikey: key } : {};
  }
  if (p === 'zapi') {
    return {};
  }
  return {};
}

/**
 * Headers para providers que não exigem descoberta assíncrona (Evolution, Z-API).
 * WAHA deve usar {@link resolveProviderAuth}.
 */
export function getProviderAuthHeadersSync(provider) {
  const p = String(provider || '').toLowerCase().trim();
  if (p === 'waha') {
    throw new Error('WAHA requer resolveProviderAuth("waha") (assíncrono).');
  }
  return staticProviderHeaders(p);
}

export async function resolveProviderAuth(provider) {
  const p = String(provider || '').toLowerCase().trim();
  if (p === 'waha') {
    const headers = await resolveWaha();
    return { headers };
  }
  return { headers: staticProviderHeaders(p) };
}

export function invalidateWahaAuthCache() {
  cache.waha = { mode: 'x_api_key', key: WAHA_API_KEY };
}

async function resolveWaha() {
  cache.waha.mode = 'x_api_key';
  cache.waha.key = WAHA_API_KEY;
  return buildWahaHeaders();
}

function buildWahaHeaders() {
  const mode = cache.waha.mode || 'x_api_key';
  if (mode === 'x_api_key') {
    return { 'X-Api-Key': cache.waha.key || WAHA_API_KEY };
  }
  return {
    'X-Api-Key': WAHA_API_KEY,
  };
}
