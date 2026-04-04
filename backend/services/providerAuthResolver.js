/**
 * Resolução dinâmica de headers de autenticação para providers WhatsApp (WAHA, Evolution, Z-API).
 * WAHA: tenta x-api-key (legado OMNIA), depois header apikey (SIMPLE), depois criação de key via dashboard (CORE).
 */

import fetch from 'node-fetch';

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
    mode: null,
    key: null,
  },
};

/** Evita múltiplas sondagens / POST /api/keys em paralelo no cold start. */
let wahaDetectPromise = null;

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
  cache.waha = { mode: null, key: null };
  wahaDetectPromise = null;
}

async function resolveWaha() {
  if (cache.waha.mode) {
    return buildWahaHeaders();
  }
  if (!wahaDetectPromise) {
    wahaDetectPromise = detectWahaAuthMode().finally(() => {
      wahaDetectPromise = null;
    });
  }
  await wahaDetectPromise;
  return buildWahaHeaders();
}

async function detectWahaAuthMode() {
  const base = WAHA_BASE;
  if (!base) {
    cache.waha.mode = 'x_api_key_env';
    return;
  }

  if (WAHA_API_KEY) {
    try {
      const res = await fetch(`${base}/api/sessions`, {
        method: 'GET',
        headers: {
          'x-api-key': WAHA_API_KEY,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(12000),
      });
      if (res.status !== 401) {
        cache.waha.mode = 'x_api_key_env';
        return;
      }
    } catch {
      /* tentar SIMPLE */
    }

    try {
      const res = await fetch(`${base}/api/sessions`, {
        method: 'GET',
        headers: {
          apikey: WAHA_API_KEY,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(12000),
      });
      if (res.status !== 401) {
        cache.waha.mode = 'simple';
        return;
      }
    } catch {
      /* tentar CORE */
    }
  }

  try {
    const key = await createWahaCoreKey(base);
    cache.waha.mode = 'core';
    cache.waha.key = key;
    return;
  } catch (e) {
    console.warn('[providerAuthResolver] WAHA CORE indisponível:', e?.message || e);
  }

  cache.waha.mode = 'x_api_key_env';
}

function buildWahaHeaders() {
  const mode = cache.waha.mode || 'x_api_key_env';
  if (mode === 'simple') {
    return {
      apikey: WAHA_API_KEY,
    };
  }
  if (mode === 'core') {
    return {
      'x-api-key': cache.waha.key || '',
    };
  }
  return {
    'x-api-key': WAHA_API_KEY,
  };
}

async function createWahaCoreKey(base) {
  const username = process.env.WAHA_DASHBOARD_USERNAME || 'admin';
  const password = (process.env.WAHA_DASHBOARD_PASSWORD || '').trim();
  if (!password) {
    throw new Error('WAHA_DASHBOARD_PASSWORD não definido');
  }
  const basicAuth = Buffer.from(`${username}:${password}`, 'utf8').toString('base64');
  const res = await fetch(`${base}/api/keys`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Basic ${basicAuth}`,
    },
    body: JSON.stringify({ name: 'omnia-auto' }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Erro ao criar API KEY WAHA: ${res.status} ${txt.slice(0, 200)}`);
  }
  const data = await res.json().catch(() => ({}));
  const key = data.key || data.apiKey || data.token || data?.data?.key;
  if (!key || typeof key !== 'string') {
    throw new Error('Erro ao criar API KEY WAHA: resposta sem key');
  }
  return key.trim();
}
