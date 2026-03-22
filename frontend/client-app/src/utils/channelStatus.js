export const getStatusMeta = (status) => {
  const s = (status || '').toLowerCase();
  switch (s) {
    case 'connected':
    case 'open':
    case 'active':
      return { label: 'Conectado', color: 'green' };
    case 'connecting':
    case 'recreated':
      return { label: s === 'recreated' ? 'Reconectando...' : 'Conectando...', color: 'orange' };
    case 'created':
      return { label: 'Criado', color: 'gray' };
    case 'disconnected':
    case 'close':
    case 'inactive':
      return { label: 'Desconectado', color: 'red' };
    case 'error':
      return { label: 'Erro', color: 'red' };
    case 'unknown':
      return { label: 'Indisponível', color: 'gray' };
    default:
      return { label: '—', color: 'black' };
  }
};

