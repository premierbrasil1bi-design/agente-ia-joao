import { useEffect } from 'react';

export default function useAutoReconnect(channels, startPolling) {
  useEffect(() => {
    (channels || []).forEach((ch) => {
      const t = String(ch?.type || '').toLowerCase();
      const ext = ch?.external_id != null && String(ch.external_id).trim() !== '';
      if (t === 'whatsapp' && !ext) return;
      if (ch?.status === 'disconnected' && (ch?.active || ch?.is_active)) {
        startPolling(ch.id);
      }
    });
  }, [channels, startPolling]);
}

