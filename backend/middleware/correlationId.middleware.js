import { getCorrelationIdFromRequest } from '../utils/correlationId.js';

/**
 * Define `req.correlationId` e ecoa no header de resposta (rastreio ponta a ponta).
 */
export function correlationIdMiddleware(req, res, next) {
  const id = getCorrelationIdFromRequest(req);
  req.correlationId = id;
  try {
    res.setHeader('x-correlation-id', id);
  } catch {
    /* headers já enviados */
  }
  next();
}
