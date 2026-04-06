/**
 * Circuit breaker global WAHA — reduz carga quando há instabilidade; auto-reset após 60s ou 3 QRs OK seguidos.
 */

let circuitOpen = false;
let lastOpenedAt = null;

let consecutiveQrSuccesses = 0;

const AUTO_RESET_MS = 60_000;
const SUCCESSES_TO_CLOSE = 3;

export function openCircuit() {
  circuitOpen = true;
  lastOpenedAt = Date.now();
  console.log('[WAHA] CIRCUIT OPENED');
}

export function closeCircuit() {
  circuitOpen = false;
  lastOpenedAt = null;
  consecutiveQrSuccesses = 0;
  console.log('[WAHA] CIRCUIT CLOSED');
}

export function isCircuitOpen() {
  if (!circuitOpen) return false;

  if (Date.now() - lastOpenedAt > AUTO_RESET_MS) {
    closeCircuit();
    return false;
  }

  return true;
}

/** Chamado quando um fluxo getQrCode termina com QR disponível. */
export function recordSuccessfulQrFlow() {
  consecutiveQrSuccesses += 1;
  if (consecutiveQrSuccesses >= SUCCESSES_TO_CLOSE) {
    closeCircuit();
  }
}

/** Quebra a sequência de sucessos (qualquer outro término de fluxo QR). */
export function resetConsecutiveQrSuccess() {
  consecutiveQrSuccesses = 0;
}

export function getCircuitDebugState() {
  return {
    rawCircuitOpen: circuitOpen,
    lastOpenedAt,
    consecutiveQrSuccesses,
  };
}
