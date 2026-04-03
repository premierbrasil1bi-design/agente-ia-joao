import * as wahaService from '../wahaService.js';
import {
  resolveWahaSessionName,
  WAHA_CORE_DEFAULT_SESSION,
} from '../../utils/wahaSession.util.js';

export async function connect(config = {}, channel = null) {
  let ctx = {};
  let session;
  if (channel?.tenant_id != null && channel?.id != null) {
    ctx = { tenantId: channel.tenant_id, channelId: channel.id };
    session = resolveWahaSessionName({
      tenantId: channel.tenant_id,
      channelId: channel.id,
    });
  } else if (process.env.WAHA_MULTI_SESSION === 'true') {
    throw new Error('Canal obrigatório para WAHA em modo multi-sessão (WAHA_MULTI_SESSION=true)');
  } else {
    session = WAHA_CORE_DEFAULT_SESSION;
  }

  console.log('[WAHA] Session:', session);
  const created = await wahaService.createSession(session, ctx);
  if (!created.ok) {
    throw new Error(created.error || 'Falha ao conectar WhatsApp (WAHA)');
  }

  const qrOut = await wahaService.getQrCode(session, ctx);
  if (!qrOut.ok) {
    throw new Error(qrOut.error || 'Falha ao conectar WhatsApp (WAHA)');
  }
  if (qrOut.alreadyConnected) {
    return {
      provider: 'waha',
      qr: null,
      raw: null,
      session,
      config,
      alreadyConnected: true,
    };
  }

  return {
    provider: 'waha',
    qr: qrOut.data,
    raw: qrOut.raw,
    session,
    config,
  };
}
