export class BaseProvider {
  constructor(config = {}) {
    this.config = config || {};
  }

  async connect() {
    throw new Error('Método connect() não implementado.');
  }

  async getQRCode() {
    throw new Error('Método getQRCode() não implementado.');
  }

  async getStatus() {
    throw new Error('Método getStatus() não implementado.');
  }

  async sendMessage(payload) {
    void payload;
    throw new Error('Método sendMessage() não implementado.');
  }

  async provisionInstance() {
    throw new Error('Método provisionInstance() não implementado.');
  }

  async disconnect() {
    throw new Error('Método disconnect() não implementado.');
  }

  async removeInstance() {
    // opcional por provider
    return { skipped: true, reason: 'not_supported' };
  }
}
