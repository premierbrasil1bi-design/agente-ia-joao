/**
 * Logger estruturado central para sessão WhatsApp (JSON por linha).
 * Evento = nome lógico; payload = campos de correlação / operação.
 */

function baseLine(level, event, payload) {
  const p = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  return {
    ts: new Date().toISOString(),
    level,
    event,
    layer: 'whatsapp_session',
    ...p,
  };
}

function write(line) {
  try {
    const s = JSON.stringify(line);
    if (line.level === 'error') console.error(s);
    else if (line.level === 'warn') console.warn(s);
    else if (line.level === 'debug') console.debug(s);
    else console.log(s);
  } catch {
    console.log('[whatsapp_session_logger]', line.event, line.operation ?? line.message);
  }
}

export const whatsappLogger = {
  /**
   * @param {string} event
   * @param {Record<string, unknown>} [payload]
   */
  info(event, payload) {
    write(baseLine('info', event, payload));
  },
  /**
   * @param {string} event
   * @param {Record<string, unknown>} [payload]
   */
  warn(event, payload) {
    write(baseLine('warn', event, payload));
  },
  /**
   * @param {string} event
   * @param {Record<string, unknown>} [payload]
   */
  error(event, payload) {
    write(baseLine('error', event, payload));
  },
  /**
   * @param {string} event
   * @param {Record<string, unknown>} [payload]
   */
  debug(event, payload) {
    write(baseLine('debug', event, payload));
  },
};
