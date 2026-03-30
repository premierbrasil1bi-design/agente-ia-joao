import * as wahaService from '../wahaService.js';

export async function connect(config = {}, channel = null) {
  const session = wahaService.resolveWahaSessionName(channel) || 'default';
  const created = await wahaService.createSession(session);
  if (!created.ok) {
    throw new Error(created.error || 'Falha ao conectar WhatsApp (WAHA)');
  }

  const qrOut = await wahaService.getQrCode(session);
  if (!qrOut.ok) {
    throw new Error(qrOut.error || 'Falha ao conectar WhatsApp (WAHA)');
  }

  return {
    provider: 'waha',
    qr: qrOut.data,
    raw: qrOut.raw,
    session,
    config,
  };
}
