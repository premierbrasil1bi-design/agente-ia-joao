import * as wahaService from '../services/wahaService.js';
import { extractQrPayload, toQrDataUrl } from '../utils/extractQrPayload.js';
import { BaseProvider } from './base.provider.js';
import { checkProviderHealth } from '../services/providerHealth.service.js';

export class WahaProvider extends BaseProvider {
  constructor(config = {}) {
    super(config);
    const s = String(config.session || config.instance || config.instanceName || '').trim();
    if (!s) {
      throw new Error('Config WAHA sem session/instance (use mergeProviderConfigForConnect)');
    }
    this.session = s;
    this.channelId = config.channelId ?? null;
    this.tenantId = config.tenantId ?? null;
  }

  _ctx() {
    return { channelId: this.channelId, tenantId: this.tenantId };
  }

  async connect() {
    console.log('[PROVIDER] connect', {
      provider: 'waha',
      session: this.session,
      channelId: this.channelId,
      tenantId: this.tenantId,
    });
    try {
      await checkProviderHealth('waha');
      const created = await wahaService.createSession(this.session, this._ctx());
      if (wahaService.isWahaUnauthorizedResult(created)) {
        const e = new Error(created.error || 'WAHA não autorizado');
        e.httpStatus = 401;
        throw e;
      }
      if (!created.ok) {
        const e = new Error(created.error || 'Falha ao conectar WhatsApp (WAHA)');
        if (created.httpStatus) e.httpStatus = created.httpStatus;
        throw e;
      }
      return { connected: false, session: this.session };
    } catch (err) {
      const msg = err?.message || '';
      if (err.httpStatus === 401) throw err;
      if (msg.includes('Falha ao conectar') && err.httpStatus) throw err;
      if (err.code === 'WAHA_UNREACHABLE') throw err;
      if (/WAHA_API_URL|WAHA_API_KEY/.test(msg)) throw err;
      console.error('[WAHA ERROR]:', err.response?.data || err.message);
      throw new Error(err.message || 'Falha ao conectar WhatsApp (WAHA)');
    }
  }

  async getQRCode() {
    try {
      const qrOut = await wahaService.getQrCode(this.session, this._ctx());
      if (wahaService.isWahaUnauthorizedResult(qrOut)) {
        const e = new Error(qrOut.error || 'WAHA não autorizado');
        e.httpStatus = 401;
        throw e;
      }
      if (!qrOut.ok) {
        const e = new Error(qrOut.error || 'QR não disponível');
        if (qrOut.httpStatus) e.httpStatus = qrOut.httpStatus;
        throw e;
      }
      const payload =
        extractQrPayload(qrOut.raw) ||
        extractQrPayload(qrOut.data) ||
        (typeof qrOut.data === 'string' ? qrOut.data : null);
      const qr = toQrDataUrl(payload) || payload || qrOut.data;
      return qr;
    } catch (err) {
      if (err.httpStatus === 401) throw err;
      if (err.message === 'QR não disponível') throw err;
      console.error('[WAHA ERROR]:', err.response?.data || err.message);
      throw err;
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
