/**
 * Logger simples para diagnóstico da integração Evolution API.
 * Registra: criação de instância, reconexão, erros de API, mudança de status.
 */

const PREFIX = '[evolution]';

function ts() {
  return new Date().toISOString();
}

export const logger = {
  instanceCreated(instanceName, channelId) {
    console.log(`${ts()} ${PREFIX} instance_created instance=${instanceName} channelId=${channelId ?? '—'}`);
  },

  reconnect(instanceName, channelId) {
    console.log(`${ts()} ${PREFIX} reconnect instance=${instanceName} channelId=${channelId ?? '—'}`);
  },

  apiError(operation, instanceName, message) {
    console.error(`${ts()} ${PREFIX} api_error operation=${operation} instance=${instanceName ?? '—'} message=${message}`);
  },

  statusChange(instanceName, channelId, fromStatus, toStatus, tenantId = null) {
    console.log(`${ts()} ${PREFIX} status_change instance=${instanceName} channelId=${channelId ?? '—'} ${fromStatus ?? '—'} -> ${toStatus}`);
    try {
      if (globalThis.io && tenantId && channelId) {
        globalThis.io.to(`tenant:${String(tenantId)}`).emit('channel_status_update', {
          channelId,
          tenantId: String(tenantId),
          status: toStatus,
        });
      }
    } catch {
      // evitar quebrar o fluxo caso websocket não esteja configurado
    }
  },
};
