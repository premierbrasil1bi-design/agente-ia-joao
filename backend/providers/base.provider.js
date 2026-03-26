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
}
