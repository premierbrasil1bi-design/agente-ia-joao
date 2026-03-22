import { evolutionLog } from './evolutionLog.js';

/**
 * Circuit breaker para não sobrecarregar a Evolution quando ela ou o Postgres estão instáveis.
 */
export class EvolutionCircuitBreaker {
  constructor({ failureThreshold = 5, openDurationMs = 45000 } = {}) {
    this.failureThreshold = failureThreshold;
    this.openDurationMs = openDurationMs;
    this.failures = 0;
    /** @type {'closed' | 'open' | 'half_open'} */
    this.state = 'closed';
    this.openedAt = 0;
  }

  async execute(fn) {
    const now = Date.now();
    if (this.state === 'open') {
      if (now - this.openedAt >= this.openDurationMs) {
        this.state = 'half_open';
        evolutionLog('CIRCUIT_HALF_OPEN', null, {});
      } else {
        const err = new Error(
          'Evolution API indisponível (circuit breaker aberto). Aguarde e tente novamente.'
        );
        err.code = 'EVOLUTION_CIRCUIT_OPEN';
        throw err;
      }
    }

    try {
      const result = await fn();
      this.#onSuccess();
      return result;
    } catch (e) {
      this.#onFailure();
      throw e;
    }
  }

  #onSuccess() {
    this.failures = 0;
    this.state = 'closed';
  }

  #onFailure() {
    if (this.state === 'half_open') {
      this.state = 'open';
      this.openedAt = Date.now();
      evolutionLog('CIRCUIT_OPEN', null, { reason: 'half_open_failure' });
      return;
    }
    this.failures += 1;
    if (this.failures >= this.failureThreshold) {
      this.state = 'open';
      this.openedAt = Date.now();
      evolutionLog('CIRCUIT_OPEN', null, { failures: this.failures });
    }
  }
}
