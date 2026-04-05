/**
 * Fallback sequencial entre providers WhatsApp (timeout, classificação de erro, ordem dinâmica).
 */

/**
 * @param {Promise<T>} promise
 * @param {number} [ms]
 * @returns {Promise<T>}
 * @template T
 */
async function withTimeout(promise, ms = 10000) {
  let id;
  const timeoutPromise = new Promise((_, reject) => {
    id = setTimeout(() => reject(new Error('timeout')), ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (id != null) clearTimeout(id);
  }
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isProviderError(error) {
  const msg = String(
    error && typeof error === 'object' && 'message' in error ? error.message : error || '',
  ).toLowerCase();

  return (
    msg.includes('timeout') ||
    msg.includes('econn') ||
    msg.includes('network') ||
    msg.includes('503') ||
    msg.includes('connection')
  );
}

/**
 * @param {{ providers?: string[] }} [ctx]
 * @returns {string[]}
 */
function getDefaultProviderOrder(ctx) {
  if (ctx?.providers?.length) {
    return ctx.providers
      .map((p) => String(p || '').toLowerCase().trim())
      .filter((p) => p.length > 0);
  }
  return ['waha', 'evolution', 'zapi'];
}

/**
 * @template T
 * @param {(provider: string) => Promise<T>} operation
 * @param {{
 *   providers?: string[],
 *   skipProviders?: string[],
 *   correlationId?: string|null
 * }} [ctx]
 * @returns {Promise<T & { providerUsed: string }>}
 */
export async function executeWithProviderFallback(operation, ctx = {}) {
  const providers = getDefaultProviderOrder(ctx);
  const skip = new Set(
    (Array.isArray(ctx?.skipProviders) ? ctx.skipProviders : [])
      .map((p) => String(p || '').toLowerCase().trim())
      .filter((p) => p.length > 0),
  );

  if (providers.length === 0) {
    throw new Error('[Fallback] todos providers falharam: unknown');
  }

  let lastError = null;

  for (const provider of providers) {
    if (skip.has(provider)) {
      continue;
    }

    try {
      console.log('[Fallback]', {
        action: 'try',
        provider,
        correlationId: ctx?.correlationId ?? null,
      });

      const result = await withTimeout(operation(provider), 10000);

      if (result != null && result.success !== false && result.ok !== false) {
        console.log('[Fallback]', {
          action: 'success',
          provider,
          correlationId: ctx?.correlationId ?? null,
        });

        return {
          ...result,
          providerUsed: provider,
        };
      }

      const msg =
        (result && typeof result === 'object' && (result.error || result.message)) ||
        'operation returned unsuccessful';
      lastError = new Error(String(msg));
    } catch (error) {
      const errMsg =
        error && typeof error === 'object' && 'message' in error
          ? String(error.message)
          : String(error);

      console.warn('[Fallback]', {
        action: 'error',
        provider,
        error: errMsg,
        correlationId: ctx?.correlationId ?? null,
      });

      if (!isProviderError(error)) {
        throw error;
      }

      lastError = error;
    }
  }

  const lastMsg =
    lastError && typeof lastError === 'object' && 'message' in lastError
      ? String(lastError.message)
      : 'unknown';
  throw new Error('[Fallback] todos providers falharam: ' + lastMsg);
}
