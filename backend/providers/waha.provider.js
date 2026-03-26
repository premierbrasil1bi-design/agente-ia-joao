import axios from 'axios';
import { BaseProvider } from './base.provider.js';

export class WahaProvider extends BaseProvider {
  constructor(config = {}) {
    super(config);
    this.session = String(config.session || 'default').trim() || 'default';
    this.baseURL = String(config.baseURL || process.env.WAHA_URL || 'http://saas_waha:3000').replace(/\/$/, '');
    this.api = axios.create({
      baseURL: this.baseURL,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(process.env.WAHA_API_KEY ? { 'X-Api-Key': process.env.WAHA_API_KEY } : {}),
      },
      timeout: 30000,
    });
  }

  async connect() {
    // WAHA Core: sessão padrão, tentativa idempotente.
    try {
      await this.api.post(`/api/sessions/${encodeURIComponent(this.session)}/start`, {});
    } catch {
      await this.api.post('/api/sessions', { name: this.session, start: true });
    }
    return { connected: false, session: this.session };
  }

  async getQRCode() {
    const { data } = await this.api.get(`/api/sessions/${encodeURIComponent(this.session)}/qrcode`);
    const raw = data?.qr || data?.base64 || data?.qrcode || data;
    if (typeof raw === 'string' && !raw.startsWith('data:')) {
      return `data:image/png;base64,${raw}`;
    }
    return raw;
  }

  async getStatus() {
    const { data } = await this.api.get(`/api/sessions/${encodeURIComponent(this.session)}/status`);
    return data;
  }

  async sendMessage(payload) {
    const digits = String(payload?.number || '').replace(/\D/g, '');
    const text = String(payload?.text || '');
    const { data } = await this.api.post('/api/sendText', {
      session: this.session,
      chatId: `${digits}@c.us`,
      text,
    });
    return data;
  }
}
