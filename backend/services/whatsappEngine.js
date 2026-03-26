import { pool } from '../db/pool.js';
import * as channelRepo from '../repositories/channel.repository.js';
import * as wahaProvider from './providers/wahaProvider.js';
import * as evolutionProvider from './providers/evolutionProvider.js';
import * as zapiProvider from './providers/zapiProvider.js';

const providers = {
  waha: wahaProvider,
  evolution: evolutionProvider,
  zapi: zapiProvider,
};

const SUPPORTED = new Set(Object.keys(providers));

function normalizeProviderList(channel) {
  const primary = String(channel?.provider || '').toLowerCase().trim();
  const fallback = Array.isArray(channel?.fallback_providers) ? channel.fallback_providers : [];
  const ordered = [primary, ...fallback.map((p) => String(p || '').toLowerCase().trim())]
    .filter((p) => SUPPORTED.has(p));
  return [...new Set(ordered)];
}

async function updateChannelStatus(channel, status, provider, lastError = null) {
  await channelRepo.updateConnection(channel.id, channel.tenant_id, {
    connection_status: status,
    provider,
    last_error: lastError,
  });
}

async function logProviderError(channelId, provider, error) {
  await pool.query(
    `INSERT INTO provider_logs (channel_id, provider, status, error)
     VALUES ($1, $2, 'error', $3)`,
    [channelId, provider, String(error || 'unknown_error')]
  );
}

export async function connectChannel(channel) {
  const priorityList = normalizeProviderList(channel);
  if (priorityList.length === 0) {
    throw new Error('Nenhum provider WhatsApp válido configurado.');
  }

  for (const providerName of priorityList) {
    const provider = providers[providerName];
    const providerCfg =
      channel?.config && typeof channel.config === 'object'
        ? (channel.config[providerName] || {})
        : {};

    try {
      console.log(`[TRY] ${providerName}`);
      const result = await provider.connect(providerCfg, channel);
      const nextStatus = result?.connected ? 'connected' : 'connecting';
      await updateChannelStatus(channel, nextStatus, providerName, null);
      return {
        provider: providerName,
        ...result,
      };
    } catch (error) {
      const message = error?.message || `Falha no provider ${providerName}`;
      console.error(`[FAIL ${providerName}]`, message);
      await logProviderError(channel.id, providerName, message);
      await updateChannelStatus(channel, 'error', providerName, message);
    }
  }

  throw new Error('All providers failed');
}
