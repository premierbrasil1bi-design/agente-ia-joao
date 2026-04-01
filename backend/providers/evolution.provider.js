import { BaseProvider } from './base.provider.js';
import * as evolutionService from '../services/evolutionService.js';
import { extractQrPayload, toQrDataUrl } from '../utils/extractQrPayload.js';

export class EvolutionProvider extends BaseProvider {
  constructor(config = {}) {
    super(config);
    this.instance = String(config.instance || config.instanceName || 'default').trim();
  }

  async connect() {
    console.log('[EVOLUTION] connect', { provider: 'evolution', instance: this.instance });
    await evolutionService.connectInstance(this.instance, { reset: false });
    return { connected: false, instance: this.instance };
  }

  async getQRCode() {
    console.log('[EVOLUTION] getQRCode', { provider: 'evolution', instance: this.instance });
    const qrRaw = await evolutionService.getQRCode(this.instance);
    const payload = extractQrPayload(qrRaw);
    return toQrDataUrl(payload) || payload || qrRaw;
  }

  async getStatus() {
    return evolutionService.getStatus(this.instance);
  }

  async sendMessage(payload) {
    const number = String(payload?.number || '');
    const text = String(payload?.text || '');
    return evolutionService.sendText(this.instance, number, text);
  }
}
