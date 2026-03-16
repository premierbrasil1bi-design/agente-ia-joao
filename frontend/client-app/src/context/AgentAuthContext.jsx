/**
 * Contexto de autenticação AGENTE IA OMNICANAL – exclusivo: agent_token e agent_user no LocalStorage.
 * Isolado do SIS-ACOLHE. Usado para RequireAuth e exibição do usuário.
 */

import { createContext, useContext, useState, useCallback, useEffect } from 'react';

const AGENT_TOKEN = 'agent_token';
const AGENT_USER = 'agent_user';

const AgentAuthContext = createContext(null);

export function AgentAuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem(AGENT_TOKEN));
  const [agent, setAgent] = useState(() => {
    try {
      const s = localStorage.getItem(AGENT_USER);
      return s ? JSON.parse(s) : null;
    } catch {
      return null;
    }
  });

  const login = useCallback((newToken, agentData) => {
    localStorage.setItem(AGENT_TOKEN, newToken);
    localStorage.setItem(AGENT_USER, JSON.stringify(agentData || {}));
    setToken(newToken);
    setAgent(agentData || null);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(AGENT_TOKEN);
    localStorage.removeItem(AGENT_USER);
    setToken(null);
    setAgent(null);
  }, []);

  useEffect(() => {
    const t = localStorage.getItem(AGENT_TOKEN);
    const a = localStorage.getItem(AGENT_USER);
    if (t !== token) setToken(t);
    if (a) {
      try {
        const parsed = JSON.parse(a);
        if (JSON.stringify(parsed) !== JSON.stringify(agent)) setAgent(parsed);
      } catch {}
    } else if (agent) setAgent(null);
  }, []);

  const getToken = useCallback(() => token || localStorage.getItem(AGENT_TOKEN), [token]);

  const value = {
    token,
    agent,
    isAuthenticated: !!token,
    login,
    logout,
    getToken,
  };

  return <AgentAuthContext.Provider value={value}>{children}</AgentAuthContext.Provider>;
}

export function useAgentAuth() {
  const ctx = useContext(AgentAuthContext);
  if (!ctx) throw new Error('useAgentAuth deve ser usado dentro de AgentAuthProvider');
  return ctx;
}
