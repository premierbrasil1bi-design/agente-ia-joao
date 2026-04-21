import { normalizeChannelStatus } from './channelCore.js';

export const getStatusMeta = (status) => {
  const s = normalizeChannelStatus(status);
  switch (s) {
    case 'CONNECTED':
      return { label: 'Conectado', color: 'green' };
    case 'PENDING':
      return { label: 'Aguardando leitura do QR', color: 'orange' };
    case 'ERROR':
      return { label: 'Erro', color: 'red' };
    case 'DISCONNECTED':
      return { label: 'Offline', color: 'red' };
    case 'UNKNOWN':
      return { label: 'Offline', color: 'gray' };
    default:
      return { label: 'Offline', color: 'gray' };
  }
};
