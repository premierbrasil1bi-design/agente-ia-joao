/**
 * Mapeia estado bruto da Evolution API para valores aceitos pela constraint channels.status (active | inactive).
 */
export function mapEvolutionStatus(status) {
  if (!status) return 'inactive';

  switch (String(status).toLowerCase()) {
    case 'open':
    case 'connected':
      return 'active';

    case 'close':
    case 'disconnected':
      return 'inactive';

    default:
      return 'inactive';
  }
}

/** Valor para a coluna evolution_status (TEXT); objetos viram JSON. */
export function toEvolutionStatusColumn(val) {
  if (val == null || val === '') return null;
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (typeof val === 'object') {
    try {
      return JSON.stringify(val);
    } catch {
      return null;
    }
  }
  return String(val);
}
