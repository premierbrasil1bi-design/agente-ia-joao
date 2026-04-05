/**
 * Timeout operacional para promises (cluster-safe, sem dependências).
 */

import { createSessionOpError, SessionOpErrorCode } from '../services/whatsapp/whatsappSessionErrors.js';

/**
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {{ code?: string, message?: string, correlationId?: string|null, operation?: string, meta?: Record<string, unknown> }} [opts]
 * @returns {Promise<T>}
 * @template T
 */
export function withTimeout(promise, ms, opts = {}) {
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
