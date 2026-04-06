/**
 * Hardening WAHA: timeout global, lock por sessão, cancelamento de polling QR (multi-tenant / produção).
 */

export const WAHA_GLOBAL_TIMEOUT_MS =
  parseInt(process.env.WHATSAPP_WAHA_GLOBAL_TIMEOUT_MS || '15000', 10) || 15000;

const WAHA_CONSECUTIVE_FAIL_STOP = parseInt(process.env.WHATSAPP_WAHA_FAIL_STOP || '3', 10) || 3;

/**
 * @param {Promise<T>} promise
 * @param {number} [ms]
 * @returns {Promise<T>}
 * @template T
 */
export function withWahaTimeout(promise, ms = WAHA_GLOBAL_TIMEOUT_MS) {
  let id;
  const t = Number.isFinite(ms) && ms > 0 ? ms : WAHA_GLOBAL_TIMEOUT_MS;
  const timeoutPromise = new Promise((_, reject) => {
    id = setTimeout(() => reject(new Error('WAHA_TIMEOUT')), t);
  });
  return Promise.race([
    promise.then(
      (v) => {
        clearTimeout(id);
        return v;
      },
      (e) => {
        clearTimeout(id);
        throw e;
      },
    ),
    timeoutPromise,
  ]);
}

/**
 * @param {string} session
 * @param {string} step
 * @param {Record<string, unknown>} [extra]
 */
export function wahaStructuredLog(session, step, extra = {}) {
  const key = String(session || 'default').trim() || 'default';
  const tryPart = extra.try != null ? `[TRY:${extra.try}]` : '';
  const rest = { ...extra };
  delete rest.try;
  let cidPart = '';
  if (rest.correlationId != null && String(rest.correlationId).trim() !== '') {
    const cid = String(rest.correlationId).trim().slice(0, 32);
    cidPart = `[CID:${cid}]`;
  }
  delete rest.correlationId;
  const restKeys = Object.keys(rest);
  const tail = restKeys.length ? ` ${JSON.stringify(rest)}` : '';
  console.log(`[WAHA]${cidPart}[SESSION:${key}][STEP:${step}]${tryPart}${tail}`);
}

/** @type {Map<string, Promise<unknown>>} */
const sessionLocks = new Map();

/**
 * Serializa operações WAHA por nome de sessão (evita corridas no mesmo session).
 * Chamadas concorrentes aguardam a mesma promise.
 * @param {string} session
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 * @template T
 */
export async function withWahaSessionLock(session, fn) {
  const key = String(session || 'default').trim() || 'default';
  if (sessionLocks.has(key)) {
    wahaStructuredLog(key, 'LOCK_WAIT', {});
    return sessionLocks.get(key);
  }
  const promise = (async () => {
    try {
      return await fn();
    } finally {
      sessionLocks.delete(key);
    }
  })();
  sessionLocks.set(key, promise);
  return promise;
}

/** @type {Map<string, { cancelled: boolean }>} */
const activeQrRequests = new Map();

/**
 * Cancela polling QR anterior da mesma sessão e registra novo controle.
 * @param {string} session
 * @returns {{ cancelled: boolean }}
 */
export function beginWahaQrPoll(session) {
  const key = String(session || 'default').trim() || 'default';
  const prev = activeQrRequests.get(key);
  if (prev) {
    prev.cancelled = true;
    wahaStructuredLog(key, 'QR_POLL_CANCEL_PREVIOUS', {});
  }
  const control = { cancelled: false };
  activeQrRequests.set(key, control);
  return control;
}

/**
 * @param {string} session
 */
export function endWahaQrPoll(session) {
  const key = String(session || 'default').trim() || 'default';
  activeQrRequests.delete(key);
}

export { WAHA_CONSECUTIVE_FAIL_STOP };
