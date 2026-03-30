import * as wahaService from '../services/wahaService.js';
import { extractQrPayload, toQrDataUrl } from '../utils/extractQrPayload.js';
import { BaseProvider } from './base.provider.js';

export class WahaProvider extends BaseProvider {
  constructor(config = {}) {
    super(config);
    this.session = String(
      config.session || config.instance || config.instanceName || 'default'
    ).trim() || 'default';
  }

  async connect() {
    console.log('PROVIDER:', 'waha');
    console.log('INSTANCE:', this.session);
    console.log('WAHA URL:', process.env.WAHA_API_URL || process.env.WAHA_URL || '');
    try {
      const created = await wahaService.createSession(this.session);
      if (!created.ok) {
        throw new Error(created.error || 'Falha ao conectar WhatsApp (WAHA)');
      }
      return { connected: false, session: this.session };
    } catch (err) {
      const msg = err?.message || '';
      if (msg.includes('Falha ao conectar WhatsApp (WAHA)')) throw err;
      console.error('ERRO WAHA:', err.response?.data || err.message);
      throw new Error('Falha ao conectar WhatsApp (WAHA)');
    }
  }

  async getQRCode() {
    try {
      const qrOut = await wahaService.getQrCode(this.session);
      if (!qrOut.ok) {
        throw new Error(qrOut.error || 'Falha ao obter QR (WAHA)');
      }
      const payload =
        extractQrPayload(qrOut.raw) ||
        extractQrPayload(qrOut.data) ||
        (typeof qrOut.data === 'string' ? qrOut.data : null);
      const qr = toQrDataUrl(payload) || payload || qrOut.data;
      return qr;
    } catch (err) {
      const msg = err?.message || '';
      if (msg.includes('Falha ao obter QR') || msg.includes('Falha ao conectar WhatsApp (WAHA)')) {
        throw err;
      }
      console.error('ERRO WAHA:', err.response?.data || err.message);
      throw new Error('Falha ao conectar WhatsApp (WAHA)');
    }
  }

  async getStatus() {
    const st = await wahaService.getSessionStatus(this.session);
    if (!st.ok) throw new Error(st.error || 'WAHA status failed');
    return st.data;
  }

  async sendMessage(payload) {
    const digits = String(payload?.number || '').replace(/\D/g, '');
    const text = String(payload?.text || '');
    const out = await wahaService.sendMessage(this.session, digits, text);
    if (!out.ok) throw new Error(out.error || 'WAHA sendMessage failed');
    return out.data;
  }
}
