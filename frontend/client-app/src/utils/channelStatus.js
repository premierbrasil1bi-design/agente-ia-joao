export const getStatusMeta = (status) => {
  switch (status) {
    case 'connected':
      return { label: 'Conectado', color: 'green' };
    case 'connecting':
      return { label: 'Conectando...', color: 'orange' };
    case 'created':
      return { label: 'Criado', color: 'gray' };
    case 'disconnected':
      return { label: 'Desconectado', color: 'red' };
    case 'error':
      return { label: 'Erro', color: 'red' };
    default:
      return { label: '—', color: 'black' };
  }
};

