import { checkChannelHealth } from '../services/channelHealth.service.js';
import { provisioningQueue } from '../queues/provisioning.queue.js';
import { findActiveChannels } from '../repositories/channel.repository.js';

async function processWithConcurrency(items, limit, handler) {
  const results = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index++;
      try {
        results[currentIndex] = await handler(items[currentIndex]);
      } catch (err) {
        console.error('[POOL ERROR]', err?.message || err);
      }
    }
  }

  const safeLimit = Math.max(1, Math.min(limit, items.length || 1));
  const workers = Array.from({ length: safeLimit }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function runHealthMonitor() {
  const DEFAULT_CONCURRENCY = 5;
  const rawEnvValue = process.env.HEALTH_MONITOR_CONCURRENCY;
  let parsedConcurrency = Number(rawEnvValue);

  if (rawEnvValue !== undefined && (Number.isNaN(parsedConcurrency) || parsedConcurrency <= 0)) {
    console.warn(
      `[MONITOR] Valor inválido para HEALTH_MONITOR_CONCURRENCY: "${rawEnvValue}". Usando default (${DEFAULT_CONCURRENCY})`,
    );
    parsedConcurrency = DEFAULT_CONCURRENCY;
  }

  if (parsedConcurrency > 50) {
    console.warn(
      `[MONITOR] HEALTH_MONITOR_CONCURRENCY muito alto (${parsedConcurrency}). Será limitado a 50.`,
    );
  }

  if (parsedConcurrency < 1 && parsedConcurrency !== DEFAULT_CONCURRENCY) {
    console.warn(
      `[MONITOR] HEALTH_MONITOR_CONCURRENCY muito baixo (${parsedConcurrency}). Será ajustado para mínimo (1).`,
    );
  }

  const CONCURRENCY_LIMIT = Math.max(
    1,
    Math.min(parsedConcurrency || DEFAULT_CONCURRENCY, 50),
  );

  if (rawEnvValue !== undefined) {
    console.log(
      `[MONITOR] HEALTH_MONITOR_CONCURRENCY definido como: ${rawEnvValue} -> usando: ${CONCURRENCY_LIMIT}`,
    );
  }
  const channels = await findActiveChannels();
  console.log(
    `[MONITOR] Verificando ${channels.length} canais com concorrência ${CONCURRENCY_LIMIT}`,
  );

  await processWithConcurrency(channels, CONCURRENCY_LIMIT, async (channel) => {
    try {
      const healthy = await checkChannelHealth(channel);
      console.log(`[MONITOR] Canal ${channel.id} saudável? ${healthy}`);

      if (!healthy) {
        console.warn('[MONITOR] Canal offline:', channel.id);
        await provisioningQueue.add(
          'retry-provision',
          { channel },
          {
            jobId: `retry-${channel.id}`,
            removeOnComplete: true,
            removeOnFail: false,
          },
        );
      }
    } catch (err) {
      console.error('[MONITOR ERROR]', err?.message || err);
    }
  });
}
