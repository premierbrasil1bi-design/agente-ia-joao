import * as evolutionService from '../evolutionService.js';
import { extractQrPayload, toQrDataUrl } from '../../utils/extractQrPayload.js';

export async function connect(config = {}, channel = null) {
  const instance =
    String(config.instance || channel?.external_id || channel?.instance || 'default')
      .trim();

  await evolutionService.connectInstance(instance, { reset: false });
  const qrRaw = await evolutionService.getQRCode(instance);
  const qrPayload = extractQrPayload(qrRaw);
  const qr = toQrDataUrl(qrPayload) || qrPayload || qrRaw;

  return {
    provider: 'evolution',
    qr,
    raw: qrRaw,
    instance,
  };
}
