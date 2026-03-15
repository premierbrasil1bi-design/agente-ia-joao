/**
 * Normalização de estado da Evolution API para formato padronizado da API.
 * open → connected, close → disconnected, connecting → connecting, outros → unknown.
 */
export function normalizeEvolutionState(state) {
  const s = state != null ? String(state).trim().toLowerCase() : '';
  const map = {
    open: 'connected',
    close: 'disconnected',
    connecting: 'connecting',
  };
  return map[s] ?? (s ? s : 'unknown');
}
