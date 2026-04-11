/**
 * Timeout operacional para promises (cluster-safe, sem dependências).
 */

import { createSessionOpError, SessionOpErrorCode } from '../services/whatsapp/whatsappSessionErrors.js';
import { log } from './logger.js';

/**
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {{ code?: string, message?: string, correlationId?: string|null, operation?: string, meta?: Record<string, unknown> }} [opts]
 * @returns {Promise<T>}
 * @template T
 */
export function withTimeout(promise, ms, opts = {}) {
  // Modo compatível novo: withTimeout(promise, ms, fallback)
  // Quando o 3º argumento NÃO é objeto de opções, usa fallback em timeout.
  const isLegacyOptsObject =
    opts != null &&
    typeof opts === 'object' &&
    !Array.isArray(opts) &&
    ('code' in opts || 'message' in opts || 'correlationId' in opts || 'operation' in opts || 'meta' in opts);

  if (!isLegacyOptsObject) {
    const hasWrappedFallback = opts && typeof opts === 'object' && Object.prototype.hasOwnProperty.call(opts, '__timeoutFallback');
    const fallback = hasWrappedFallback ? opts.__timeoutFallback : opts;
    const operation = hasWrappedFallback ? String(opts.operation || 'unknown') : 'unknown';
    if (!Number.isFinite(ms) || ms <= 0) return promise;
    return Promise.race([
      promise,
      new Promise((resolve) => {
        setTimeout(() => {
          log.warn({
            event: 'PROVIDER_TIMEOUT',
            context: 'service',
            duration: ms,
            metadata: { timeoutMs: ms, operation },
          });
          resolve(fallback);
        }, ms);
      }),
    ]);
  }

  const code = opts.code || SessionOpErrorCode.PROVIDER_TIMEOUT;
  const message = opts.message || `Operação excedeu ${ms}ms`;
  const correlationId = opts.correlationId ?? null;
  const operation = opts.operation ?? null;
  const meta = opts.meta && typeof opts.meta === 'object' ? opts.meta : {};

  if (!Number.isFinite(ms) || ms <= 0) {
    return promise;
  }

  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(
        createSessionOpError(code, message, {
          correlationId,
          operation,
          timeoutMs: ms,
          ...meta,
        }),
      );
    }, ms);
  });

  return Promise.race([
    promise.then(
      (v) => {
        clearTimeout(timer);
        return v;
      },
      (e) => {
        clearTimeout(timer);
        throw e;
      },
    ),
    timeoutPromise,
  ]);
}
