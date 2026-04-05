import { randomUUID } from 'crypto';

const HEADER_CANDIDATES = ['x-correlation-id', 'x-request-id', 'x-trace-id'];

/**
 * @param {import('express').Request | { headers?: Record<string, string|undefined> } | null | undefined} req
 * @returns {string}
 */
export function getCorrelationIdFromRequest(req) {
  if (!req || typeof req !== 'object') return randomUUID();
  const h = req.headers;
  if (!h || typeof h !== 'object') return randomUUID();
  for (const name of HEADER_CANDIDATES) {
    const v = h[name] ?? h[name.toLowerCase()];
    const s = Array.isArray(v) ? v[0] : v;
    const t = s != null ? String(s).trim() : '';
    if (t) return t.slice(0, 128);
  }
  return randomUUID();
}

/**
 * @param {string | null | undefined} id
 * @returns {string}
 */
export function ensureCorrelationId(id) {
  const t = id != null ? String(id).trim() : '';
  return t ? t.slice(0, 128) : randomUUID();
}
