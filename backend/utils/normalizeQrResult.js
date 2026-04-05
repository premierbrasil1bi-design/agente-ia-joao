import { extractQrPayload, toQrDataUrl } from './extractQrPayload.js';
import { WHATSAPP_UNIFIED_QR_KIND } from './whatsappQrContract.js';

/**
 * Contrato unificado com marcador explícito (preferido).
 */
function isUnifiedQrByMarker(o) {
  return (
    o != null &&
    typeof o === 'object' &&
    !Array.isArray(o) &&
    o.__kind === WHATSAPP_UNIFIED_QR_KIND &&
    o.__contractVersion === 1 &&
    typeof o.success === 'boolean'
  );
}

/**
 * Legado (pré-__kind): exige meta com sinal conhecido do nosso builder para evitar colisão com objetos genéricos.
 * @deprecated Remover após janela de migração.
 */
function isLegacyUnifiedQrShape(o) {
  if (o == null || typeof o !== 'object' || Array.isArray(o)) return false;
  if (o.__kind != null) return false;
  if (typeof o.success !== 'boolean') return false;
  if (!('format' in o) || !('qr' in o)) return false;
  if (!('session' in o) || !('provider' in o) || !('state' in o) || !('source' in o) || !('error' in o)) return false;
  if (!('meta' in o) || o.meta == null || typeof o.meta !== 'object' || Array.isArray(o.meta)) return false;
  const m = o.meta;
  return Boolean(m.path != null || m.prepare != null || m.dockerSnapshot === true);
}

function isUnifiedQrContract(o) {
  return isUnifiedQrByMarker(o) || isLegacyUnifiedQrShape(o);
}

function isNormalizedQrEnvelope(o) {
  if (o == null || typeof o !== 'object' || Array.isArray(o)) return false;
  if (typeof o.success !== 'boolean') return false;
  if (!('format' in o)) return false;
  if (o.format != null && o.format !== 'image' && o.format !== 'ascii') return false;
  if (o.qr != null && typeof o.qr !== 'string') return false;
  return true;
}

/**
 * Converte saída bruta de qualquer provider em formato estável para HTTP/socket.
 * @param {unknown} qrRaw
 * @returns {{ success: boolean, format: 'image'|'ascii'|null, qr: string|null, message?: string|null, session?: string|null, provider?: string|null, state?: string|null, source?: string|null, error?: string|null, meta?: Record<string, unknown>, qrCode?: string, qrcode?: string, correlationId?: string|null }}
 */
export function normalizeQrResult(qrRaw) {
  if (qrRaw == null || qrRaw === '') {
    return {
      success: false,
      format: null,
      qr: null,
      message: 'QR não disponível',
    };
  }

  if (typeof qrRaw === 'object' && !Array.isArray(qrRaw)) {
    if (isUnifiedQrContract(qrRaw)) {
      const out = {
        success: qrRaw.success,
        format: qrRaw.format ?? null,
        qr: qrRaw.qr ?? null,
        message: qrRaw.message ?? qrRaw.error ?? null,
        session: qrRaw.session ?? null,
        provider: qrRaw.provider ?? null,
        state: qrRaw.state ?? null,
        source: qrRaw.source ?? null,
        error: qrRaw.error ?? null,
        meta:
          qrRaw.meta && typeof qrRaw.meta === 'object' && !Array.isArray(qrRaw.meta)
            ? { ...qrRaw.meta }
            : {},
      };
      if (qrRaw.qrCode != null) out.qrCode = qrRaw.qrCode;
      if (qrRaw.qrcode != null) out.qrcode = qrRaw.qrcode;
      if (qrRaw.correlationId != null) out.correlationId = String(qrRaw.correlationId).slice(0, 128);
      return out;
    }

    if (isNormalizedQrEnvelope(qrRaw)) {
      return {
        success: qrRaw.success,
        format: qrRaw.format ?? null,
        qr: qrRaw.qr ?? null,
        message: qrRaw.message ?? null,
      };
    }

    if (qrRaw.format === 'ascii' && qrRaw.qr != null) {
      const q = String(qrRaw.qr).trim();
      return q
        ? { success: true, format: 'ascii', qr: String(qrRaw.qr) }
        : {
            success: false,
            format: null,
            qr: null,
            message: 'QR não disponível',
          };
    }

    if (typeof qrRaw.imageDataUrl === 'string' && qrRaw.imageDataUrl.trim()) {
      return normalizeQrResult(qrRaw.imageDataUrl.trim());
    }

    if (typeof qrRaw.ascii === 'string' && qrRaw.ascii.trim()) {
      return { success: true, format: 'ascii', qr: qrRaw.ascii };
    }

    if (qrRaw.base64 != null) {
      const b = typeof qrRaw.base64 === 'string' ? qrRaw.base64.trim() : String(qrRaw.base64).trim();
      if (!b) {
        return {
          success: false,
          format: null,
          qr: null,
          message: 'QR não disponível',
        };
      }
      const qr = b.startsWith('data:image')
        ? b
        : `data:image/png;base64,${b.replace(/^data:image\/\w+;base64,/i, '')}`;
      return { success: true, format: 'image', qr };
    }

    const extracted = extractQrPayload(qrRaw);
    if (extracted) {
      return normalizeQrResult(extracted);
    }

    return {
      success: false,
      format: null,
      qr: null,
      message: 'Formato de QR desconhecido',
    };
  }

  if (typeof qrRaw === 'string') {
    const t = qrRaw.trim();
    if (!t) {
      return {
        success: false,
        format: null,
        qr: null,
        message: 'QR não disponível',
      };
    }
    if (t.startsWith('data:image')) {
      return { success: true, format: 'image', qr: t };
    }
    if (/^https?:\/\//i.test(t)) {
      return { success: true, format: 'image', qr: t };
    }
    const asImg = toQrDataUrl(t);
    if (asImg && asImg.startsWith('data:image')) {
      return { success: true, format: 'image', qr: asImg };
    }
    return { success: true, format: 'ascii', qr: t };
  }

  return {
    success: false,
    format: null,
    qr: null,
    message: 'Formato de QR desconhecido',
  };
}
