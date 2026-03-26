import * as wahaService from '../wahaService.js';

export async function connect(config = {}) {
  const created = await wahaService.createSession('default');
  if (!created.ok) {
    throw new Error(created.error || 'WAHA connection failed');
  }

  const qrOut = await wahaService.getQrCode('default');
  if (!qrOut.ok) {
    throw new Error(qrOut.error || 'WAHA connection failed');
  }

  return {
    provider: 'waha',
    qr: qrOut.data,
    raw: qrOut.raw,
    session: 'default',
    config,
  };
}
