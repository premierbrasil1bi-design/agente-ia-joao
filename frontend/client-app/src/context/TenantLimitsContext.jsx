import { createContext, useContext, useEffect, useMemo } from 'react';
import { useTenantLimits } from '../hooks/useTenantLimits.js';
import { useBillingSync } from '../hooks/useBillingSync.js';

const TenantLimitsContext = createContext(undefined);

export function TenantLimitsProvider({ children }) {
  const { plan, limits, usage, features, loading, error, refresh } = useTenantLimits();

  useBillingSync(refresh, { pollingMs: 30_000 });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('billing') !== 'success') return;
    (async () => {
      await refresh().catch(() => {});
      const clean = `${window.location.pathname || '/'}${window.location.hash || ''}`;
      window.history.replaceState({}, '', clean);
    })();
  }, [refresh]);

  const value = useMemo(
    () => ({
      plan,
      limits,
      usage,
      features,
      loading,
      error,
      refresh,
    }),
    [plan, limits, usage, features, loading, error, refresh],
  );

  return <TenantLimitsContext.Provider value={value}>{children}</TenantLimitsContext.Provider>;
}

export function useTenantLimitsContext() {
  const ctx = useContext(TenantLimitsContext);
  if (ctx === undefined) {
    throw new Error('useTenantLimitsContext deve ser usado dentro de TenantLimitsProvider.');
  }
  return ctx;
}

/** Fallback seguro fora do provider: testes, Storybook, telas isoladas. */
export { useTenantLimits } from '../hooks/useTenantLimits.js';
