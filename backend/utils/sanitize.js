/**
 * Sanitização básica de entradas (evitar injeção e valores gigantes).
 * Nunca logar secrets; usar apenas para strings de negócio.
 */

const MAX_STRING = 10_000;
const MAX_EMAIL = 255;

/**
 * Trim e limita tamanho. Retorna string vazia se não for string.
 */
export function sanitizeString(value, maxLength = MAX_STRING) {
  if (value == null) return '';
  const s = String(value).trim();
  return s.length > maxLength ? s.slice(0, maxLength) : s;
}

/**
 * Para uso em email (login, etc.).
 */
export function sanitizeEmail(value) {
  return sanitizeString(value, MAX_EMAIL).toLowerCase();
}

/**
 * Canal: normaliza para lowercase e valida contra lista permitida.
 */
const ALLOWED_CHANNELS = new Set(['web', 'api', 'whatsapp', 'instagram']);

export function sanitizeChannel(value) {
  const s = sanitizeString(value, 20).toLowerCase();
  return ALLOWED_CHANNELS.has(s) ? s : 'web';
}
