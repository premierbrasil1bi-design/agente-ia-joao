/**
 * Logs padronizados para integração Evolution (observabilidade / SaaS).
 */
export function evolutionLog(action, instance, extra = {}) {
  const ts = new Date().toISOString();
  const inst = instance != null && instance !== '' ? String(instance) : '-';
  const keys = Object.keys(extra);
  const tail = keys.length ? ` extra=${JSON.stringify(extra)}` : '';
  console.log(`[EVOLUTION] action=${action} instance=${inst} timestamp=${ts}${tail}`);
}
