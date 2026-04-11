import { useEffect } from 'react';

/**
 * Mantém limites/plano alinhados ao billing: refetch ao focar a aba e polling leve opcional.
 * @param {() => Promise<unknown>} refresh - ex.: useTenantLimits().refresh
 * @param {{ pollingMs?: number }} [options] - pollingMs 0 desativa intervalo (default 30_000)
 */
export function useBillingSync(refresh, options = {}) {
  const pollingMs = options.pollingMs ?? 30_000;

  useEffect(() => {
    if (typeof window === 'undefined' || typeof refresh !== 'function') {
      return undefined;
    }

    const run = () => {
      refresh().catch(() => {});
    };

    const onFocus = () => run();
    window.addEventListener('focus', onFocus);

    const onVis = () => {
      if (document.visibilityState === 'visible') run();
    };
    document.addEventListener('visibilitychange', onVis);

    let id;
    if (pollingMs > 0) {
      id = window.setInterval(run, pollingMs);
    }

    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVis);
      if (id != null) window.clearInterval(id);
    };
  }, [refresh, pollingMs]);
}
