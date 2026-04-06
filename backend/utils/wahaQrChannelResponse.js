import { pickUnifiedQrTransportFields } from './whatsappQrContract.js';

/** Resposta HTTP canônica para GET qrcode (WAHA). */
export function buildWahaQrcodeJsonResponse(result, correlationId) {
  const cid = result.correlationId ?? correlationId ?? null;
  const body = {
    success: Boolean(result.success),
    state: result.state ?? null,
    qr: result.qr ?? null,
    format: result.format ?? null,
    provider: 'waha',
    message: result.message ?? null,
  };
  if (cid) body.correlationId = cid;
  if (result.format === 'image' && result.qr) {
    body.qrCode = result.qr;
    body.qrcode = result.qr;
  }
  if (result.format === 'ascii' && result.qr) {
    body.qrAscii = result.qr;
  }
  Object.assign(body, pickUnifiedQrTransportFields(result));
  return body;
}

/** Payload socket `channel:qr` alinhado ao estado explícito (WAHA). */
export function buildWahaQrcodeSocketPayload(channel, result, correlationId) {
  const st = String(result.state || '').toUpperCase() || null;
  let legacyStatus = 'PENDING';
  if (st === 'OFFLINE') legacyStatus = 'offline';
  else if (st === 'UNSTABLE' || st === 'UNAVAILABLE') legacyStatus = 'error';
  else if (st === 'CANCELLED') legacyStatus = 'idle';
  else if (st === 'CONNECTED') legacyStatus = 'connected';

  return {
    channelId: channel.id,
    tenantId: channel.tenant_id,
    state: st,
    qr: result.qr ?? null,
    format: result.format ?? null,
    provider: 'waha',
    message: result.message ?? null,
    correlationId: result.correlationId ?? correlationId ?? null,
    status: legacyStatus,
    qrCode: result.format === 'image' ? result.qr : null,
    qrAscii: result.format === 'ascii' ? result.qr : null,
    connected: st === 'CONNECTED',
  };
}
