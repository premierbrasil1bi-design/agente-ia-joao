export { wahaProvider, wahaRequest, validateWahaEnv } from '../services/wahaHttp.js';
export { resolveWahaSessionName, WAHA_CORE_DEFAULT_SESSION } from '../utils/wahaSession.util.js';

import * as wahaService from '../services/wahaService.js';
import { getCurrentQr } from '../services/wahaQrCapture.js';
import { resolveWahaSessionName } from '../utils/wahaSession.util.js';
import { BaseProvider } from './base.provider.js';
import { checkProviderHealth } from '../services/providerHealth.service.js';
import * as wahaProvision from '../services/wahaProvision.service.js';

export class WahaProvider extends BaseProvider {
  constructor(config = {}) {
    super(config);
    this.channelId = config.channelId ?? null;
    this.tenantId = config.tenantId ?? null;
    let s;
    if (this.tenantId != null && this.channelId != null) {
      s = resolveWahaSessionName({
        tenantId: this.tenantId,
        channelId: this.channelId,
      });
    } else {
      s = String(config.session || config.instance || config.instanceName || '').trim();
    }
    if (!s) {
      throw new Error('Config WAHA sem session/instance (use mergeProviderConfigForConnect)');
    }
    console.log('[WAHA] Session:', s);
    this.session = s;
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
    const qr = getCurrentQr();
    if (qr) {
      return qr;
    }
    return null;
  }

  async getStatus() {
    const st = await wahaService.getSessionStatus(this.session, this._ctx());
    if (!st.ok) throw new Error(st.error || 'WAHA status failed');
    return st.data;
  }

  async sendMessage(payload) {
    const digits = String(payload?.number || '').replace(/\D/g, '');
    const text = String(payload?.text || '');
    const out = await wahaService.sendMessage(this.session, digits, text, this._ctx());
    if (!out.ok) throw new Error(out.error || 'WAHA sendMessage failed');
    return out.data;
  }

  async provisionInstance(channel = null) {
    const channelId = channel?.id || this.channelId;
    const tenantId = channel?.tenant_id || this.tenantId;
    if (!channelId || !tenantId) throw new Error('WahaProvider.provisionInstance exige channelId e tenantId.');
    return wahaProvision.provisionWhatsAppInstance(channelId, tenantId);
  }

  async disconnect() {
    const out = await wahaService.logoutSession(this.session, this._ctx());
    if (!out.ok) throw new Error(out.error || 'WAHA disconnect failed');
    return out;
  }

  async removeInstance() {
    const out = await wahaService.deleteSession(this.session, this._ctx());
    if (!out.ok) throw new Error(out.error || 'WAHA removeSession failed');
    return out;
  }
}
