/**
 * ChannelContextProvider – centraliza o canal ativo para toda a aplicação.
 * Permite troca dinâmica de canal; expõe canal para todas as requisições da API.
 * O sistema SEMPRE sabe e informa qual canal está rodando.
 */

import { createContext, useContext, useState, useCallback, useEffect } from 'react';

const ChannelContext = createContext(null);

const DEFAULT_CHANNEL = 'web';
const CANAIS_DISPONIVEIS = ['web', 'api', 'whatsapp', 'instagram'];

function validateChannel(value) {
  const v = (value || DEFAULT_CHANNEL).trim().toLowerCase();
  return CANAIS_DISPONIVEIS.includes(v) ? v : DEFAULT_CHANNEL;
}

export function ChannelProvider({ children }) {
  const [channel, setChannelState] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return validateChannel(params.get('channel'));
  });
  const [contextData, setContextData] = useState(null);

  const setChannel = useCallback((newChannel) => {
    const normalized = validateChannel(newChannel);
    setChannelState(normalized);
    const url = new URL(window.location.href);
    url.searchParams.set('channel', normalized);
    window.history.replaceState({}, '', url.toString());
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('channel');
    if (fromUrl && validateChannel(fromUrl) !== channel) {
      setChannelState(validateChannel(fromUrl));
    }
  }, [channel]);

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
