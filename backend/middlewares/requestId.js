import { randomUUID } from 'node:crypto';
import { runWithLogContext } from '../utils/logger.js';

export function requestIdMiddleware(req, res, next) {
  const incoming = req.header('x-request-id');
  const requestId = incoming && String(incoming).trim() ? String(incoming).trim() : randomUUID();
  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);
  runWithLogContext({ requestId }, () => next());
}
