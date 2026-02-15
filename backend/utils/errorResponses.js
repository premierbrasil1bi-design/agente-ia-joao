/**
 * Respostas de erro padronizadas para a API.
 * Uso consistente de status HTTP e corpo { error, code? }.
 */

/**
 * 401 Unauthorized – não autenticado (token ausente ou inválido).
 */
export function sendUnauthorized(res, message = 'Não autenticado. Faça login.') {
  return res.status(401).json({ error: message, code: 'UNAUTHORIZED' });
}

/**
 * 403 Forbidden – autenticado mas não autorizado ao recurso.
 */
export function sendForbidden(res, message = 'Acesso negado a este recurso.') {
  return res.status(403).json({ error: message, code: 'FORBIDDEN' });
}

/**
 * 400 Bad Request – parâmetros inválidos.
 */
export function sendBadRequest(res, message = 'Requisição inválida.') {
  return res.status(400).json({ error: message, code: 'BAD_REQUEST' });
}

/**
 * 404 Not Found – recurso não encontrado.
 */
export function sendNotFound(res, message = 'Recurso não encontrado.') {
  return res.status(404).json({ error: message, code: 'NOT_FOUND' });
}

/**
 * 500 Internal Server Error – erro interno (não expor detalhes ao cliente em produção).
 */
export function sendServerError(res, message = 'Erro interno do servidor.', logError = null) {
  if (logError) console.error('[API error]', logError.message || logError);
  return res.status(500).json({ error: message, code: 'INTERNAL_ERROR' });
}
