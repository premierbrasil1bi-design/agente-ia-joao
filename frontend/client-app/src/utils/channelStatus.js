import { normalizeChannelStatus } from './channelCore.js';

export const getStatusMeta = (status) => {
  const s = normalizeChannelStatus(status);
  switch (s) {
    case 'CONNECTED':
      return { label: 'Conectado', color: 'green' };
    case 'PENDING':
      return { label: 'Aguardando leitura...', color: 'orange' };
    case 'DISCONNECTED':
      return { label: 'Desconectado', color: 'red' };
    case 'UNKNOWN':
      return { label: 'Indisponível', color: 'gray' };
    default:
      return { label: '—', color: 'black' };
  }
};

