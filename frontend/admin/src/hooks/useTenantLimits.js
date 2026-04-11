import { useCallback, useEffect, useRef, useState } from 'react';
import { getApiBaseUrl } from '../config/env.js';
import { agentApi } from '../services/agentApi.js';

/** Admin: mesmo JWT do agente; backend aceita em /api/tenant/limits (authJWT). */
const LIMITS_PATH = '/api/tenant/limits';

/**
 * @returns {{
 *   loading: boolean,
 *   error: string | null,
 *   plan: string | null,
 *   limits: object,
 *   usage: object,
 *   features: { realtimeMonitoring?: boolean },
 *   refresh: () => Promise<void>,
 * }}
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
        const token = agentApi.getToken?.();
        if (!token) {
          setLoading(false);
          setError('Não autenticado');
          return;
        }
        setLoading(true);
        setError(null);
        try {
          const base = getApiBaseUrl();
          const res = await fetch(`${base}${LIMITS_PATH}`, {
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
          });
          const data = await res.json().catch(() => ({}));
          if (res.status === 401) {
            setError('Sessão inválida');
            return;
          }
          if (!res.ok) {
            setError(data.error || `Erro ${res.status}`);
            return;
          }
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
