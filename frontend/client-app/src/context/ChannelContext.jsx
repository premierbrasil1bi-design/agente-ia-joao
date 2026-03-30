/**
 * ChannelContextProvider – centraliza o canal ativo para toda a aplicação.
 * Persiste em localStorage e sincroniza com a URL (?channel=).
 */

import { createContext, useContext, useState, useCallback, useEffect } from 'react';

const ChannelContext = createContext(null);

const DEFAULT_CHANNEL = 'web';
const STORAGE_KEY = 'channel';
const CANAIS_DISPONIVEIS = ['web', 'api', 'whatsapp', 'instagram'];

function validateChannel(value) {
  const v = (value || DEFAULT_CHANNEL).trim().toLowerCase();
  return CANAIS_DISPONIVEIS.includes(v) ? v : DEFAULT_CHANNEL;
}

function getInitialChannel() {
  if (typeof window === 'undefined') return DEFAULT_CHANNEL;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get('channel');
    const raw = saved || fromUrl || DEFAULT_CHANNEL;
    return validateChannel(raw);
  } catch {
    return DEFAULT_CHANNEL;
  }
}

export function ChannelProvider({ children }) {
  const [channel, setChannelState] = useState(getInitialChannel);
  const [contextData, setContextData] = useState(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, channel);
      const url = new URL(window.location.href);
      if (url.searchParams.get('channel') !== channel) {
        url.searchParams.set('channel', channel);
        window.history.replaceState({}, '', url.toString());
      }
    } catch (e) {
      console.warn('[ChannelContext] persist channel:', e);
    }
  }, [channel]);

  const setChannel = useCallback((newChannel) => {
    const normalized = validateChannel(newChannel);
    setChannelState(normalized);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('channel', normalized);
      window.history.replaceState({}, '', url.toString());
    } catch (e) {
      console.warn('[ChannelContext] setChannel:', e);
    }
  }, []);

  const value = {
    channel,
    setChannel,
    canaisDisponiveis: CANAIS_DISPONIVEIS,
    contextData,
    setContextData,
  };

  return (
    <ChannelContext.Provider value={value}>
      {children}
    </ChannelContext.Provider>
  );
}

export function useChannel() {
  const ctx = useContext(ChannelContext);
  if (!ctx) {
    throw new Error('useChannel deve ser usado dentro de ChannelProvider');
  }
  return ctx;
}
