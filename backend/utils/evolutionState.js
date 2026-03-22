/**
 * Normalização de estado da Evolution API para a API do app.
 * open → connected, close → disconnected, connecting → connecting, null/vazio → created.
 */
export function normalizeEvolutionState(state) {
  if (state == null || String(state).trim() === '') {
    return 'created';
  }
  const s = String(state).trim().toLowerCase();
  const map = {
    open: 'connected',
    close: 'disconnected',
    connecting: 'connecting',
  };
  return map[s] ?? s;
}
