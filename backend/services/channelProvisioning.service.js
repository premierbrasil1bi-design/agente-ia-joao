import axios from 'axios';
import { randomUUID } from 'node:crypto';

const CONFIG = {
  WAHA_URL:
    process.env.WAHA_URL ||
    process.env.WAHA_BASE_URL ||
    process.env.WAHA_API_URL ||
    'http://saas_waha:3099',
  WAHA_API_KEY: process.env.WAHA_API_KEY || '',
  EVOLUTION_URL: process.env.EVOLUTION_URL || process.env.EVOLUTION_API_URL || 'http://saas_evolution:8080',
  EVOLUTION_API_KEY: process.env.EVOLUTION_API_KEY || '',
  API_BASE_URL: process.env.API_BASE_URL || 'http://saas_backend:3000',
};

function normalizeProvider(channel) {
  const provider = String(channel?.provider || '').toLowerCase().trim();
  if (provider) return provider;
  const type = String(channel?.type || '').toLowerCase().trim();
  return type === 'evolution' ? 'evolution' : type === 'waha' ? 'waha' : provider;
}

function webhookTarget() {
  return `${String(CONFIG.API_BASE_URL).replace(/\/$/, '')}/api/agents/webhook`;
}

function wahaHeaders() {
  return {
    'X-Api-Key': String(CONFIG.WAHA_API_KEY || '').trim(),
    'Content-Type': 'application/json',
  };
}

function evolutionHeaders() {
  return {
    apikey: String(CONFIG.EVOLUTION_API_KEY || '').trim(),
    'Content-Type': 'application/json',
  };
}

function isConflict(err) {
  const st = err?.response?.status;
  if (st === 409 || st === 422) return true;
  const msg = String(err?.response?.data?.message || err?.message || '').toLowerCase();
  return msg.includes('already') || msg.includes('exists') || msg.includes('duplic');
}

async function retry(fn, retries = 4, correlationId = null) {
  let delay = 2000;
  for (let i = 0; i < retries; i += 1) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries - 1) throw err;
      console.warn(`[${correlationId || 'NO-CID'}] [RETRY] tentativa ${i + 1} falhou`);
      await new Promise((r) => setTimeout(r, delay));
      delay *= 2;
    }
  }
  return null;
}

export async function provisionChannel(channel) {
  const correlationId = randomUUID();
  console.log(`[${correlationId}] Iniciando provisionamento do canal ${channel?.id ?? 'N/A'}`);
  const provider = normalizeProvider(channel);
  return provisionByProvider(channel, provider, correlationId);
}

function resolveFallbackProvider(primaryProvider) {
  if (primaryProvider === 'waha') return 'evolution';
  if (primaryProvider === 'evolution') return 'waha';
  return null;
}

async function provisionByProvider(channel, provider, correlationId) {
  switch (provider) {
    case 'waha':
      return provisionWaha(channel, correlationId);
    case 'evolution':
      return provisionEvolution(channel, correlationId);
    default:
      console.warn(
        `[${correlationId}] [CHANNEL_PROVISION] Provider não suportado:`,
        provider || channel?.type || null,
      );
      return { success: false, skipped: true, reason: 'provider_not_supported', correlationId };
  }
}

export async function provisionWithFallback(channel) {
  const correlationId = randomUUID();
  const primaryProvider = normalizeProvider(channel);
  console.log(`[${correlationId}] Iniciando provisionamento com fallback do canal ${channel?.id ?? 'N/A'}`);

  try {
    const primary = await provisionByProvider(channel, primaryProvider, correlationId);
    if (primary?.success) return { ...primary, attemptedProvider: primaryProvider };

    console.warn(`[${correlationId}] [FALLBACK] Provider principal falhou`);
    const fallbackProvider = resolveFallbackProvider(primaryProvider);
    if (!fallbackProvider) return { ...primary, attemptedProvider: primaryProvider };

    if (fallbackProvider === 'evolution') {
      console.log(`[${correlationId}] [FALLBACK] Tentando Evolution`);
    } else {
      console.log(`[${correlationId}] [FALLBACK] Tentando WAHA`);
    }

    const fallback = await provisionByProvider(
      { ...channel, provider: fallbackProvider, type: fallbackProvider },
      fallbackProvider,
      correlationId,
    );
    return { ...fallback, fallbackFrom: primaryProvider, attemptedProvider: fallbackProvider };
  } catch (error) {
    console.warn(`[${correlationId}] [FALLBACK] Provider principal falhou`);
    const fallbackProvider = resolveFallbackProvider(primaryProvider);
    if (!fallbackProvider) throw error;

    if (fallbackProvider === 'evolution') {
      console.log(`[${correlationId}] [FALLBACK] Tentando Evolution`);
    } else {
      console.log(`[${correlationId}] [FALLBACK] Tentando WAHA`);
    }

    return provisionByProvider(
      { ...channel, provider: fallbackProvider, type: fallbackProvider },
      fallbackProvider,
      correlationId,
    );
  }
}

async function provisionWaha(channel, correlationId) {
  const base = String(CONFIG.WAHA_URL || '').replace(/\/$/, '');
  const sessionName = String(channel?.instance || channel?.external_id || channel?.id || 'default').trim() || 'default';

  try {
    console.log(`[${correlationId}] [WAHA] Provisionando sessão ${sessionName}`);

    const sessionsRes = await axios.get(`${base}/api/sessions`, {
      headers: wahaHeaders(),
      timeout: 15000,
    });

    const sessionsRaw = sessionsRes?.data;
    const sessions = Array.isArray(sessionsRaw)
      ? sessionsRaw
      : Array.isArray(sessionsRaw?.sessions)
        ? sessionsRaw.sessions
        : [];
    const exists = sessions.some((s) => String(s?.name || s?.id || s?.session || '').trim() === sessionName);

    if (!exists) {
      await retry(
        () =>
          axios.post(
            `${base}/api/sessions`,
            { name: sessionName },
            { headers: wahaHeaders(), timeout: 20000 },
          ),
        4,
        correlationId,
      );
      console.log(`[${correlationId}] [WAHA] Sessão criada`);
    }

    const webhookUrl = webhookTarget();
    const webhookPayload = { url: webhookUrl, events: ['messages.upsert'] };
    const webhookCandidates = [
      `${base}/api/sessions/${encodeURIComponent(sessionName)}/webhooks`,
      `${base}/api/sessions/${encodeURIComponent(sessionName)}/webhook`,
    ];

    let webhookDone = false;
    let lastErr = null;
    for (const endpoint of webhookCandidates) {
      try {
        await retry(
          () =>
            axios.post(endpoint, webhookPayload, {
              headers: wahaHeaders(),
              timeout: 20000,
            }),
          4,
          correlationId,
        );
        webhookDone = true;
        break;
      } catch (err) {
        if (err?.response?.status === 409) {
          console.log(`[${correlationId}] [WAHA] Webhook já existe`);
          webhookDone = true;
          break;
        }
        if (err?.response?.status === 404 || err?.response?.status === 405) {
          lastErr = err;
          continue;
        }
        throw err;
      }
    }

    if (!webhookDone && lastErr) throw lastErr;
    if (webhookDone) console.log(`[${correlationId}] [WAHA] Webhook configurado`);

    return { success: true, provider: 'waha', sessionName, correlationId };
  } catch (error) {
    console.error(`[${correlationId}] ERRO`, error?.response?.data || error?.message || error);
    return { success: false, provider: 'waha', error: error?.message || 'waha_provision_failed', correlationId };
  }
}

async function provisionEvolution(channel, correlationId) {
  const base = String(CONFIG.EVOLUTION_URL || '').replace(/\/$/, '');
  const instanceName = String(channel?.instance || channel?.external_id || channel?.id || '').trim();
  if (!instanceName) {
    return { success: false, provider: 'evolution', error: 'instance_name_missing', correlationId };
  }

  try {
    console.log(`[${correlationId}] [EVOLUTION] Provisionando instance ${instanceName}`);

    try {
      await retry(
        () =>
          axios.post(
            `${base}/instance/create`,
            {
              instanceName,
              qrcode: true,
              integration: 'WHATSAPP-BAILEYS',
            },
            { headers: evolutionHeaders(), timeout: 30000 },
          ),
        4,
        correlationId,
      );
      console.log(`[${correlationId}] [EVOLUTION] Instance criada`);
    } catch (err) {
      if (!isConflict(err)) throw err;
      console.log(`[${correlationId}] [EVOLUTION] Instance já existe`);
    }

    const webhookUrl = webhookTarget();
    const webhookPayload = {
      instanceName,
      webhook: webhookUrl,
      events: ['messages.upsert'],
    };

    let webhookSet = false;
    let lastErr = null;
    const endpoints = [`${base}/webhook/set`, `${base}/webhook/set/${encodeURIComponent(instanceName)}`];
    for (const endpoint of endpoints) {
      try {
        await retry(
          () =>
            axios.post(endpoint, webhookPayload, {
              headers: evolutionHeaders(),
              timeout: 20000,
            }),
          4,
          correlationId,
        );
        webhookSet = true;
        break;
      } catch (err) {
        if (isConflict(err)) {
          webhookSet = true;
          break;
        }
        if (err?.response?.status === 404 || err?.response?.status === 405) {
          lastErr = err;
          continue;
        }
        throw err;
      }
    }

    if (!webhookSet && lastErr) throw lastErr;
    console.log(`[${correlationId}] [EVOLUTION] Webhook configurado`);
    return { success: true, provider: 'evolution', instanceName, correlationId };
  } catch (error) {
    console.error(`[${correlationId}] ERRO`, error?.response?.data || error?.message || error);
    return {
      success: false,
      provider: 'evolution',
      error: error?.message || 'evolution_provision_failed',
      correlationId,
    };
  }
}
