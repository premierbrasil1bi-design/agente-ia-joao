/**
 * Hook: cliente API do dashboard (canal + token + onUnauthorized).
 * Centraliza createApiClient com auth e redirect em 401.
 */

import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useChannel } from '../context/ChannelContext';
import { useAgentAuth } from '../context/AgentAuthContext';
import { createApiClient } from '../api/client';

export function useDashboardApi() {
  const { channel } = useChannel();
  const { getToken, logout } = useAgentAuth();
  const navigate = useNavigate();

  const onUnauthorized = useCallback(() => {
    logout();
    navigate('/login', { replace: true });
  }, [logout, navigate]);

  return useCallback(
    () => createApiClient(() => channel, getToken, onUnauthorized),
    [channel, getToken, onUnauthorized]
  );
}
