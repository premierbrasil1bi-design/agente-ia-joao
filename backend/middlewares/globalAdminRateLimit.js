/**
 * Rate limit para login Global Admin: 5 tentativas por 5 minutos por IP.
 * Reduz risco de brute force.
 */

const store = new Map();

const WINDOW_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;

function getClientKey(req) {
  return req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || 'unknown';
}

export default function globalAdminRateLimit(req, res, next) {
  const key = getClientKey(req);
  const now = Date.now();
  let entry = store.get(key);

  if (!entry) {
    entry = { count: 0, resetAt: now + WINDOW_MS };
    store.set(key, entry);
  }

  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + WINDOW_MS;
  }

  entry.count += 1;

  if (entry.count > MAX_ATTEMPTS) {
    return res.status(429).json({
      error: 'Muitas tentativas. Tente novamente em alguns minutos.',
      code: 'RATE_LIMIT',
    });
  }

  next();
}
