import { extractQrPayload, toQrDataUrl } from './extractQrPayload.js';

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
 * @returns {{ success: boolean, format: 'image'|'ascii'|null, qr: string|null, message?: string|null }}
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
