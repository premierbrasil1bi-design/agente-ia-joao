import { useCallback, useEffect, useRef, useState } from 'react';
import { agentApi } from '../services/agentApi.js';

/**
 * Client App: GET /api/agent/tenant/limits (JWT agente).
 * Requisições simultâneas são coalescidas (uma única rede ativa por vez).
 */
export function useTenantLimits() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [plan, setPlan] = useState(null);
  const [limits, setLimits] = useState({});
  const [usage, setUsage] = useState({});
  const [features, setFeatures] = useState({});
  const inFlightRef = useRef(null);

  const load = useCallback(async () => {
    if (inFlightRef.current) {
      return inFlightRef.current;
    }
    const run = (async () => {
      try {
        if (!agentApi.getToken?.()) {
          setLoading(false);
          setError('Não autenticado');
          return;
        }
        setLoading(true);
        setError(null);
        try {
          const data = await agentApi.request('/api/agent/tenant/limits');
          setPlan(data.plan ?? null);
          setLimits(data.limits && typeof data.limits === 'object' ? data.limits : {});
          setUsage(data.usage && typeof data.usage === 'object' ? data.usage : {});
          setFeatures(data.features && typeof data.features === 'object' ? data.features : {});
        } catch (e) {
          setError(e?.message || 'Falha ao carregar limites');
        } finally {
          setLoading(false);
        }
      } finally {
        inFlightRef.current = null;
      }
    })();
    inFlightRef.current = run;
    return run;
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return {
    loading,
    error,
    plan,
    limits,
    usage,
    features,
    refresh: load,
  };
}
