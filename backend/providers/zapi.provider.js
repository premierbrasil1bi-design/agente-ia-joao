import { BaseProvider } from './base.provider.js';

export class ZapiProvider extends BaseProvider {
  constructor(config = {}) {
    super(config);
    this.instanceId = String(config.instanceId || 'default').trim();
    this.baseURL = String(config.baseURL || process.env.ZAPI_BASE_URL || 'https://api.z-api.io').replace(/\/$/, '');
  }

  async connect() {
    return { connected: false, instanceId: this.instanceId };
  }

  async getQRCode() {
    return `${this.baseURL}/instances/${encodeURIComponent(this.instanceId)}/qr-code`;
  }

  async getStatus() {
    return { provider: 'zapi', status: 'unknown', instanceId: this.instanceId };
  }

  async sendMessage(payload) {
    return {
      provider: 'zapi',
      mocked: true,
      instanceId: this.instanceId,
      payload,
    };
  }

  async disconnect() {
    return { provider: 'zapi', skipped: true, reason: 'not_implemented' };
  }

  async removeInstance() {
    return { provider: 'zapi', skipped: true, reason: 'not_implemented' };
  }
}
