export { wahaProvider, wahaRequest, validateWahaEnv, fetchWahaSessionQrcodeRest } from '../services/wahaHttp.js';
export { resolveWahaSessionName, WAHA_CORE_DEFAULT_SESSION } from '../utils/wahaSession.util.js';

import * as wahaService from '../services/wahaService.js';
import * as whatsappSessionFacade from '../services/whatsappSessionProvider.facade.js';
import { fetchWahaSessionQrcodeRest } from '../services/wahaHttp.js';
import { getCurrentQr, getQrSnapshotFromDockerLogs } from '../services/wahaQrCapture.js';
import { resolveWahaSessionName } from '../utils/wahaSession.util.js';
// HTTP WAHA: wahaHttp → providerAuthResolver (auth dinâmica).
import { BaseWhatsAppProvider } from './base/BaseWhatsAppProvider.js';
import * as wahaProvision from '../services/wahaProvision.service.js';
import { SessionState } from '../services/whatsapp/whatsappSessionState.js';
import { buildUnifiedQrResponse } from '../utils/whatsappQrContract.js';
import { whatsappLogger } from '../services/whatsapp/whatsappSessionLogger.js';

export class WahaProvider extends BaseWhatsAppProvider {
  constructor(config = {}) {
    super(config);
    this.channelId = config.channelId ?? null;
    this.tenantId = config.tenantId ?? null;
    this.correlationId = config.correlationId != null ? String(config.correlationId).slice(0, 128) : null;
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
    return { channelId: this.channelId, tenantId: this.tenantId, correlationId: this.correlationId };
  }

  /**
   * Prepara sessão WAHA (health + ensure). Reflete estado real após prepare — não força `connected: true`.
   *
   * @returns {Promise<{
   *   connected: boolean,
   *   session: string,
   *   state: string,
   *   prepare: object,
   *   correlationId: string
   * }>}
   */
  async connect() {
    console.log('[PROVIDER] connect', {
      provider: 'waha',
      session: this.session,
      channelId: this.channelId,
      tenantId: this.tenantId,
    });
    try {
      const out = await whatsappSessionFacade.connectProviderSession('waha', {
        sessionName: this.session,
        tenantId: this.tenantId,
        channelId: this.channelId,
        correlationId: this.correlationId,
      });
      if (!out.ok) {
        const e = new Error('Falha ao conectar WhatsApp (WAHA)');
        e.code = 'CONNECT_FAILED';
        throw e;
      }
      return {
        connected: out.connected,
        session: this.session,
        state: out.state,
        prepare: out.prepare,
        correlationId: out.correlationId,
        canonical: out.canonical,
      };
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

  async getQRCode(_channel) {
    void _channel;
    const prep = await wahaService.ensureSessionReady(this.session, this._ctx());
    const prepState = prep?.state ?? SessionState.UNKNOWN;
    const baseMeta = { prepare: prep };

    if (prepState === SessionState.CONNECTED) {
      return buildUnifiedQrResponse({
        success: true,
        format: null,
        qr: null,
        session: this.session,
        provider: 'waha',
        state: prepState,
        source: null,
        error: null,
        correlationId: this.correlationId,
        meta: { ...baseMeta, path: 'waha_provider_already_connected' },
      });
    }

    try {
      const fromRest = await fetchWahaSessionQrcodeRest(this.session, { correlationId: this.correlationId });
      if (fromRest) {
        const n = this.normalize(fromRest);
        return buildUnifiedQrResponse({
          success: n.success,
          format: n.format,
          qr: n.qr,
          message: n.message,
          session: this.session,
          provider: 'waha',
          state: n.success
            ? prepState !== SessionState.UNKNOWN
              ? prepState
              : SessionState.QR_AVAILABLE
            : prepState,
          source: 'rest',
          error: n.success ? null : n.message ?? 'QR REST inválido',
          correlationId: this.correlationId,
          meta: baseMeta,
        });
      }
    } catch (err) {
      whatsappLogger.warn('waha_rest_qr_failed', {
        session: this.session,
        correlationId: this.correlationId,
        errorMessage: err?.message || String(err),
      });
    }

    try {
      const fromStream = getCurrentQr();
      if (fromStream) {
        const n = this.normalize(fromStream);
        return buildUnifiedQrResponse({
          success: n.success,
          format: n.format,
          qr: n.qr,
          message: n.message,
          session: this.session,
          provider: 'waha',
          state: SessionState.QR_AVAILABLE,
          source: 'stream',
          error: n.success ? null : n.message ?? 'QR stream inválido',
          correlationId: this.correlationId,
          meta: baseMeta,
        });
      }
    } catch {
      /* stream opcional */
    }

    try {
      const snap = await getQrSnapshotFromDockerLogs();
      if (snap?.imageDataUrl) {
        const n = this.normalize(snap.imageDataUrl);
        return buildUnifiedQrResponse({
          success: n.success,
          format: n.format,
          qr: n.qr,
          message: n.message,
          session: this.session,
          provider: 'waha',
          state: SessionState.QR_AVAILABLE,
          source: 'logs',
          error: n.success ? null : n.message ?? null,
          correlationId: this.correlationId,
          meta: { ...baseMeta, dockerSnapshot: true },
        });
      }
      if (snap?.ascii) {
        const n = this.normalize({ format: 'ascii', qr: snap.ascii });
        return buildUnifiedQrResponse({
          success: n.success,
          format: n.format,
          qr: n.qr,
          message: n.message,
          session: this.session,
          provider: 'waha',
          state: SessionState.QR_AVAILABLE,
          source: 'logs',
          error: n.success ? null : n.message ?? null,
          correlationId: this.correlationId,
          meta: { ...baseMeta, dockerSnapshot: true, ascii: true },
        });
      }
    } catch {
      /* snapshot Docker opcional */
    }

    const msg = 'QR ainda não disponível, aguardando geração';
    return buildUnifiedQrResponse({
      success: false,
      format: null,
      qr: null,
      message: msg,
      session: this.session,
      provider: 'waha',
      state: prepState,
      source: null,
      error: msg,
      correlationId: this.correlationId,
      meta: baseMeta,
    });
  }

  /**
   * Retorno legado (payload WAHA) + `sessionStatusCanonical` para HTTP/socket.
   * @param {object} [_channel]
   */
  async getStatus(_channel) {
    void _channel;
    const canonical = await whatsappSessionFacade.getProviderSessionStatus('waha', this.session, this._ctx());
    if (!canonical.success) {
      const e = new Error(canonical.error || 'WAHA status failed');
      e.httpStatus = canonical.meta?.httpStatus;
      e.code = canonical.meta?.code || 'WAHA_STATUS_FAILED';
      throw e;
    }
    const legacy = canonical.meta?.legacyPayload;
    const base =
      legacy && typeof legacy === 'object' && !Array.isArray(legacy)
        ? { ...legacy }
        : {};
    return {
      ...base,
      sessionStatusCanonical: canonical,
    };
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
