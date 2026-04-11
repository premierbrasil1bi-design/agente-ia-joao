import { AsyncLocalStorage } from 'node:async_hooks';

const PREFIX = '[evolution]';
const requestContext = new AsyncLocalStorage();

function ts() {
  return new Date().toISOString();
}

export const logger = {
  instanceCreated(instanceName, channelId) {
    writeInfo({ event: 'EVOLUTION_INSTANCE_CREATED', context: 'provider', channelId, metadata: { instanceName } });
  },

  reconnect(instanceName, channelId) {
    writeInfo({ event: 'EVOLUTION_RECONNECT', context: 'provider', channelId, metadata: { instanceName } });
  },

  apiError(operation, instanceName, message) {
    writeError({
      event: 'EVOLUTION_API_ERROR',
      context: 'provider',
      error: String(message || 'unknown_error'),
      metadata: { operation, instanceName: instanceName ?? null },
    });
  },

  statusChange(instanceName, channelId, fromStatus, toStatus, tenantId = null) {
    writeInfo({
      event: 'EVOLUTION_STATUS_CHANGE',
      context: 'provider',
      tenantId: tenantId ?? null,
      channelId,
      status: toStatus ?? null,
      metadata: {
        instanceName,
        fromStatus: fromStatus ?? null,
        toStatus: toStatus ?? null,
      },
    });
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

export const log = {
  info(payload = {}) {
    writeInfo(payload);
  },
  warn(payload = {}) {
    writeWarn(payload);
  },
  error(payload = {}) {
    writeError(payload);
  },
};

function buildLogPayload(level, payload = {}) {
  const body = payload && typeof payload === 'object' ? payload : { metadata: { message: String(payload) } };
  const requestId = requestContext.getStore()?.requestId ?? null;
  return {
    level,
    timestamp: ts(),
    event: body.event || 'GENERIC_EVENT',
    context: body.context || 'service',
    requestId,
    tenantId: body.tenantId ?? null,
    channelId: body.channelId ?? null,
    provider: body.provider ?? null,
    status: body.status ?? null,
    duration: body.duration ?? null,
    error: body.error ?? null,
    stack: body.stack ?? undefined,
    metadata: body.metadata && typeof body.metadata === 'object' ? redactSensitive(body.metadata) : {},
  };
}

function writeLine(line, stream = 'stdout') {
  const output = `${JSON.stringify(line)}\n`;
  if (stream === 'stderr') {
    process.stderr.write(output);
    return;
  }
  process.stdout.write(output);
}

function writeInfo(payload) {
  writeLine(buildLogPayload('info', payload), 'stdout');
}

function writeWarn(payload) {
  writeLine(buildLogPayload('warn', payload), 'stdout');
}

function writeError(payload) {
  const line = buildLogPayload('error', payload);
  if (process.env.NODE_ENV !== 'development') {
    delete line.stack;
  }
  writeLine(line, 'stderr');
}

export function runWithLogContext(ctx, fn) {
  const safe = ctx && typeof ctx === 'object' ? ctx : {};
  return requestContext.run(safe, fn);
}

export function overrideConsoleWithStructuredLog() {
  globalThis.console.log = (...args) => {
    writeInfo({
      event: 'CONSOLE_LOG_REDIRECTED',
      context: 'service',
      metadata: { args: safeArgs(args) },
    });
  };
  globalThis.console.warn = (...args) => {
    writeWarn({
      event: 'CONSOLE_WARN_REDIRECTED',
      context: 'service',
      metadata: { args: safeArgs(args) },
    });
  };
  globalThis.console.error = (...args) => {
    writeError({
      event: 'CONSOLE_ERROR_REDIRECTED',
      context: 'service',
      error: stringifyArgs(args),
      metadata: { args: safeArgs(args) },
    });
  };
}

function safeArgs(args) {
  return args.map((item) => {
    if (typeof item === 'string') return item;
    if (item instanceof Error) return { message: item.message, name: item.name };
    if (item && typeof item === 'object') return redactSensitive(item);
    return item;
  });
}

function stringifyArgs(args) {
  return args
    .map((item) => {
      if (item instanceof Error) return item.message;
      return typeof item === 'string' ? item : JSON.stringify(redactSensitive(item));
    })
    .join(' | ');
}

function redactSensitive(value) {
  if (!value || typeof value !== 'object') return value;
  const clone = Array.isArray(value) ? [...value] : { ...value };
  const sensitive = ['token', 'authorization', 'password', 'apiKey', 'apikey', 'qr', 'qrCode', 'credential', 'secret'];
  for (const key of Object.keys(clone)) {
    const lower = key.toLowerCase();
    if (sensitive.some((s) => lower.includes(s))) {
      clone[key] = '[REDACTED]';
      continue;
    }
    if (clone[key] && typeof clone[key] === 'object') clone[key] = redactSensitive(clone[key]);
  }
  return clone;
}
