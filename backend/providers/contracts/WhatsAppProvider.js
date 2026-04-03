/**
 * Contrato de adapter WhatsApp multi-provider (WAHA, Evolution, Z-API).
 * Implementações concretas estendem {@link BaseWhatsAppProvider} ou {@link BaseProvider}.
 */
export class WhatsAppProvider {
  async createInstance(_input) {
    throw new Error('Not implemented');
  }

  async getQRCode(_input) {
    throw new Error('Not implemented');
  }

  async getStatus(_input) {
    throw new Error('Not implemented');
  }

  async disconnect(_input) {
    throw new Error('Not implemented');
  }
}
