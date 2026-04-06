/**
 * Operações HTTP de sessão WAHA (uso interno: orquestrador).
 * Mantém wahaHttp como única porta de chamada à API WAHA para sessão.
 */

import { wahaRequest, wahaPostStartSession } from './wahaHttp.js';

export function extractStatusFromSessionEntry(entry) {
  if (entry == null || typeof entry !== 'object') return null;
  return (
    entry.status ??
    entry.state ??
    entry.session?.status ??
    entry.connectionStatus ??
    entry.me?.status ??
    null
  );
}

export async function wahaAdapterGetSessionDetail(sessionName) {
  try {
    const data = await wahaRequest('GET', `/api/sessions/${encodeURIComponent(sessionName)}`);
    const session = typeof data === 'object' && data != null ? data : null;
    const status = extractStatusFromSessionEntry(session);
    return { found: true, session, status };
  } catch (err) {
    const st = err.httpStatus ?? err.response?.status;
    if (st === 404) return { found: false, session: null, status: null };
    throw err;
  }
}

export async function wahaAdapterCreateSessionRecord(sessionName) {
  try {
    await wahaRequest('POST', '/api/sessions', {
      name: sessionName,
    });
  } catch (err) {
    const st = err.httpStatus ?? err.response?.status;
    if (st !== 409 && st !== 400) throw err;
  }
}

export async function wahaAdapterPostStart(sessionName) {
  return wahaPostStartSession(sessionName);
}
