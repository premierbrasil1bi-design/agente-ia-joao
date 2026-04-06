import { normalizeChannelStatus } from './channelCore.js';

export const getStatusMeta = (status) => {
  const state = String(status || '').trim().toUpperCase();
  if (state === 'SCAN_QR_CODE') {
    return { label: 'Aguardando leitura do QR', color: 'orange' };
  }
  if (state === 'STARTING') {
    return { label: 'Inicializando conexão', color: 'orange' };
  }
  if (state === 'WORKING') {
    return { label: 'Conectado', color: 'green' };
  }
  const s = normalizeChannelStatus(status);
  switch (s) {
    case 'CONNECTED':
      return { label: 'Conectado', color: 'green' };
    case 'PENDING':
      return { label: 'Aguardando leitura do QR', color: 'orange' };
    case 'DISCONNECTED':
      return { label: 'Offline', color: 'red' };
    case 'UNKNOWN':
      return { label: 'Offline', color: 'gray' };
    default:
      return { label: 'Offline', color: 'gray' };
  }
};

