import { useEffect } from 'react';

export default function useAutoReconnect(channels, startPolling) {
  useEffect(() => {
    (channels || []).forEach((ch) => {
      if (ch?.status === 'disconnected' && (ch?.active || ch?.is_active)) {
        startPolling(ch.id);
      }
    });
  }, [channels, startPolling]);
}

