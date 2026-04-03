import { BaseProvider } from '../base.provider.js';
import { normalizeQrResult } from '../../utils/normalizeQrResult.js';

/**
 * Base para providers WhatsApp: helpers de normalização de QR (REST/stream/logs).
 */
export class BaseWhatsAppProvider extends BaseProvider {
  normalize(qr) {
    return normalizeQrResult(qr);
  }

  success(qr) {
    return this.normalize(qr);
  }

  fail(message = 'QR não disponível') {
    return {
      success: false,
      format: null,
      qr: null,
      message,
    };
  }
}
