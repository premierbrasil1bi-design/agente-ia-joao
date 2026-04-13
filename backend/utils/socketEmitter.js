export function emitEvent(event, payload) {
  try {
    if (globalThis.io) {
      globalThis.io.emit(event, payload);
    }
  } catch {
    // WebSocket é camada opcional; nunca deve quebrar fluxo principal.
  }
}
