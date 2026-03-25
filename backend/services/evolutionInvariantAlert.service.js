/**
 * Alerta assíncrono para quebra de invariante Evolution (duplicidade external_id).
 * Fire-and-forget: não bloqueia webhooks nem repositório.
 *
 * - Rate limit por external_id via Redis SET NX + TTL (evolution:invariant_alert:<external_id>).
 * - Persiste em system_errors (migration 012).
 * - Opcional: POST JSON para EVOLUTION_INVARIANT_WEBHOOK_URL (Slack incoming, Zapier, etc.).
 */

import axios from 'axios';
import { pool } from '../db/pool.js';
import { getRedisConnection } from '../queues/evolution.queue.js';

const WEBHOOK_URL = (process.env.EVOLUTION_INVARIANT_WEBHOOK_URL || '').trim();
const WEBHOOK_TIMEOUT_MS = parseInt(
  process.env.EVOLUTION_INVARIANT_WEBHOOK_TIMEOUT_MS || '3500',
  10
);
const ALERT_TTL_SEC = Math.max(
  1,
  parseInt(process.env.EVOLUTION_INVARIANT_ALERT_TTL_SEC || '60', 10)
);

function invariantAlertRedisKey(externalId) {
  return `evolution:invariant_alert:${String(externalId).trim()}`;
}

/**
 * @param {object} p
 * @param {string} p.external_id
 * @param {number} p.duplicate_row_count
 * @param {Array<{ id: string, tenant_id: string, provider: string }>} p.channels
 */
export function fireEvolutionInvariantBrokenAlert(p) {
  const payload = {
    type: 'EVOLUTION_INVARIANT_BROKEN',
    external_id: p.external_id,
    duplicate_row_count: p.duplicate_row_count,
    channels: p.channels,
  };

  void (async () => {
    const ext = String(payload.external_id ?? '').trim();
    const redisKey = invariantAlertRedisKey(ext);

    let acquired = false;
    try {
      const redis = getRedisConnection();
      const setResult = await redis.set(redisKey, '1', 'EX', ALERT_TTL_SEC, 'NX');
      acquired = setResult === 'OK';
    } catch (err) {
      console.warn('[EVOLUTION][ALERT] redis rate-limit unavailable, sending alert anyway:', err.message);
      acquired = true;
    }

    if (!acquired) {
      console.error('[EVOLUTION][ALERT_SKIPPED_RATE_LIMIT] external_id=%s', JSON.stringify(ext));
      return;
    }

    try {
      await pool.query(
        `INSERT INTO system_errors (error_type, payload) VALUES ($1, $2::jsonb)`,
        [payload.type, JSON.stringify(payload)]
      );
    } catch (err) {
      console.warn('[EVOLUTION][ALERT] system_errors insert failed:', err.message);
    }

    if (WEBHOOK_URL) {
      try {
        await axios.post(WEBHOOK_URL, payload, {
          timeout: WEBHOOK_TIMEOUT_MS,
          headers: { 'Content-Type': 'application/json' },
          validateStatus: () => true,
        });
      } catch (err) {
        console.warn('[EVOLUTION][ALERT] webhook POST failed:', err.message);
      }
    }

    console.error(
      '[EVOLUTION][ALERT_SENT] type=%s external_id=%s duplicate_row_count=%s channels_len=%s webhook=%s ttl_sec=%s',
      payload.type,
      JSON.stringify(payload.external_id),
      String(payload.duplicate_row_count),
      String(payload.channels?.length ?? 0),
      WEBHOOK_URL ? 'yes' : 'no',
      String(ALERT_TTL_SEC)
    );
  })();
}
