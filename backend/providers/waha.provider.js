export {
  wahaProvider,
  wahaRequest,
  validateWahaEnv,
  fetchWahaSessionQrcodeRest,
  isWahaAlive,
} from '../services/wahaHttp.js';
export { resolveWahaSessionName, WAHA_CORE_DEFAULT_SESSION } from '../utils/wahaSession.util.js';

import { resolveWahaSessionName } from '../utils/wahaSession.util.js';
import * as wahaService from '../services/wahaService.js';
import * as whatsappSessionFacade from '../services/whatsappSessionProvider.facade.js';
import { SessionState } from '../services/whatsapp/whatsappSessionState.js';
import { buildUnifiedQrResponse } from '../utils/whatsappQrContract.js';
// HTTP WAHA: wahaHttp (sem API key no container; WAHA_API_URL no backend).
import { BaseWhatsAppProvider } from './base/BaseWhatsAppProvider.js';
import * as wahaProvision from '../services/wahaProvision.service.js';

/**
 * Mapeia saída de {@link wahaService.getQrCode} para contrato unificado com mensagens estáveis por estado.
 * @param {object} svc
 * @param {string} session
 * @param {string|null} correlationId
 */
function mapWahaServiceQrToUnified(svc, session, correlationId) {
  const state = String(svc?.state ?? SessionState.UNKNOWN).toUpperCase();
  const baseMeta = {
    ...(svc?.meta && typeof svc.meta === 'object' && !Array.isArray(svc.meta) ? svc.meta : {}),
    path: 'waha_provider_explicit_state',
  };

  if (state === SessionState.UNAVAILABLE) {
    return buildUnifiedQrResponse({
      success: false,
      format: null,
      qr: null,
      session,
      provider: 'waha',
      state: SessionState.UNAVAILABLE,
      source: svc?.source ?? null,
      error: svc?.error || 'WAHA temporarily disabled (circuit breaker)',
      message: 'WAHA temporarily unavailable',
      correlationId,
      meta: { ...baseMeta, path: 'waha_provider_unavailable' },
    });
  }

  if (state === SessionState.OFFLINE) {
    return buildUnifiedQrResponse({
      success: false,
      format: null,
      qr: null,
      session,
      provider: 'waha',
      state: SessionState.OFFLINE,
      source: svc?.source ?? null,
      error: 'WAHA offline',
      message: 'WAHA offline',
      correlationId,
      meta: { ...baseMeta, path: 'waha_provider_offline' },
    });
  }

  if (state === SessionState.UNSTABLE) {
    return buildUnifiedQrResponse({
      success: false,
      format: null,
      qr: null,
      session,
      provider: 'waha',
      state: SessionState.UNSTABLE,
      source: svc?.source ?? null,
      error: svc?.error || 'WAHA not responding properly',
      message: 'WAHA unstable',
      correlationId,
      meta: { ...baseMeta, path: 'waha_provider_unstable' },
    });
  }

  if (state === SessionState.CANCELLED) {
    return buildUnifiedQrResponse({
      success: false,
      format: null,
      qr: null,
      session,
      provider: 'waha',
      state: SessionState.CANCELLED,
      source: svc?.source ?? null,
      error: svc?.error || 'QR request cancelled',
      message: 'QR request cancelled',
      correlationId,
      meta: { ...baseMeta, path: 'waha_provider_cancelled' },
    });
  }

  if (state === SessionState.CONNECTED) {
    return buildUnifiedQrResponse({
      success: true,
      format: null,
      qr: null,
      session,
      provider: 'waha',
      state: SessionState.CONNECTED,
      source: svc?.source ?? null,
      error: null,
      message: null,
      correlationId,
      meta: baseMeta,
    });
  }

  if (state === SessionState.QR_AVAILABLE) {
    return buildUnifiedQrResponse({
      success: true,
      format: svc?.format ?? null,
      qr: svc?.qr ?? null,
      message: svc?.message ?? null,
      session,
      provider: 'waha',
      state: SessionState.QR_AVAILABLE,
      source: svc?.source ?? 'rest',
      error: null,
      correlationId,
      meta: baseMeta,
    });
  }

  if (state === SessionState.PENDING) {
    return buildUnifiedQrResponse({
      success: true,
      format: null,
      qr: null,
      message: 'Gerando QR Code...',
      session,
      provider: 'waha',
      state: SessionState.PENDING,
      source: svc?.source ?? null,
      error: null,
      correlationId,
      meta: baseMeta,
    });
  }

  return buildUnifiedQrResponse({
    success: Boolean(svc?.success),
    format: svc?.format ?? null,
    qr: svc?.qr ?? null,
    message: svc?.message ?? null,
    session,
    provider: 'waha',
    state: state || SessionState.UNKNOWN,
    source: svc?.source ?? null,
    error: svc?.error ?? null,
    correlationId,
    meta: baseMeta,
  });
}

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
      if (/WAHA_API_URL/.test(msg)) throw err;
      console.error('[WAHA ERROR]:', err.response?.data || err.message);
      throw new Error(err.message || 'Falha ao conectar WhatsApp (WAHA)');
    }
  }

  /**
   * QR via serviço WAHA endurecido (lock, timeout, estados CANCELLED / UNSTABLE / OFFLINE / PENDING).
   * @param {object} [_channel]
   */
  async getQRCode(_channel) {
    void _channel;
    const svc = await wahaService.getQrCode(this.session, this._ctx());
    return mapWahaServiceQrToUnified(svc, this.session, this.correlationId);
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
