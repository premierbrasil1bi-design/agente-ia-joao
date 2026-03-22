/**
 * Controller: conexão de canais WhatsApp (Evolution API).
 * Rotas: POST /:id/connect, GET /:id/qrcode, GET /:id/status, POST /:id/disconnect
 */

import * as channelRepo from '../repositories/channel.repository.js';
import * as channelConnectionService from '../services/channelConnection.service.js';
import { sendNotFound } from '../utils/errorResponses.js';
import { extractQrPayload, toQrDataUrl } from '../utils/extractQrPayload.js';

async function getChannelFromReq(req, res) {
  const tenantId = req.tenantId || req.user?.tenantId;
  if (!tenantId) {
    res.status(401).json({ success: false, error: 'Tenant não identificado.' });
    return null;
  }
  const channel = await channelRepo.findById(req.params.id, tenantId);
  if (!channel) {
    sendNotFound(res, 'Canal não encontrado.');
    return null;
  }
  return channel;
}

function isEvolutionOffline(err) {
  const c = err.code;
  return c === 'ECONNREFUSED' || c === 'ENOTFOUND' || c === 'ETIMEDOUT';
}

export async function connectChannel(req, res) {
  try {
    const channel = await getChannelFromReq(req, res);
    if (!channel) return;

    console.log('[CONNECT_CHANNEL] channelId:', channel.id, 'tenantId:', channel.tenant_id);
    const result = await channelConnectionService.connectWhatsAppChannel(channel);

    res.status(200).json({
      success: true,
      instance: result.instanceName,
      evolution: {
        create: result.createResponse,
        connect: result.connectResponse,
      },
      channel: result.channel,
    });
  } catch (err) {
    console.error('[channelConnection] connectChannel:', err.message, err.response?.status || err.code || '');
    if (err.code === 'INSTANCE_NOT_FOUND') {
      return res.status(200).json({
        success: false,
        error: true,
        message: err.message || 'Instance not created',
        code: 'INSTANCE_NOT_FOUND',
      });
    }
    if (isEvolutionOffline(err)) {
      return res.status(503).json({
        success: false,
        error: 'Evolution API está offline ou inacessível. Verifique o container/serviço e a variável EVOLUTION_API_URL.',
      });
    }
    res.status(500).json({
      success: false,
      error: err.message || 'Erro ao conectar canal.',
    });
  }
}

export async function getQrCode(req, res) {
  try {
    const channel = await getChannelFromReq(req, res);
    if (!channel) return;

    console.log('[GET_QRCODE] channelId:', channel.id);
    const qr = await channelConnectionService.getChannelQrCode(channel);
    const raw = extractQrPayload(qr);
    const dataUrl = toQrDataUrl(raw);

    if (!dataUrl) {
      return res.status(404).json({
        success: false,
        error: 'QR não disponível ainda',
      });
    }

    res.status(200).json({
      success: true,
      qr: dataUrl,
      qrcode: dataUrl,
    });
  } catch (err) {
    console.error('[channelConnection] getQrCode:', err.message, err.response?.status || err.code || '');
    if (isEvolutionOffline(err)) {
      return res.status(503).json({
        success: false,
        error: 'Evolution API está offline ou inacessível.',
      });
    }
    res.status(500).json({
      success: false,
      error: err.message || 'Erro ao obter QR Code.',
    });
  }
}

export async function getStatus(req, res) {
  try {
    const channel = await getChannelFromReq(req, res);
    if (!channel) return;

    console.log('[CHECK_STATUS] channelId:', channel.id);
    const result = await channelConnectionService.getChannelStatus(channel);

    if (result.instanceNotFound) {
      return res.status(200).json({
        success: false,
        error: true,
        message: result.message || 'Instance not created',
        code: result.code || 'INSTANCE_NOT_FOUND',
      });
    }

    if (result.evolutionOffline) {
      return res.status(200).json({
        success: true,
        status: 'disconnected',
        normalizedStatus: 'offline',
        evolutionOffline: true,
        message: 'Serviço temporariamente indisponível'
      });
    }

    const rawState = result.state?.state ?? result.state?.instance?.state ?? null;
    res.status(200).json({
      success: true,
      status: result.normalizedStatus,
      normalizedStatus: result.normalizedStatus,
      evolutionState: rawState,
      channel: result.channel,
      recreated: Boolean(result.recreated),
    });
  } catch (err) {
    console.error('[channelConnection] getStatus:', err.message, err.response?.status || err.code || '');
    return res.status(200).json({
      success: true,
      status: 'disconnected',
      normalizedStatus: 'offline',
      evolutionOffline: true,
      message: 'Serviço temporariamente indisponível'
    });
  }
}

export async function disconnectChannel(req, res) {
  try {
    const channel = await getChannelFromReq(req, res);
    if (!channel) return;

    console.log('[DISCONNECT_CHANNEL] channelId:', channel.id);
    await channelConnectionService.disconnectChannel(channel);

    res.status(200).json({
      success: true,
      message: 'Canal desconectado.',
    });
  } catch (err) {
    console.error('[channelConnection] disconnectChannel:', err.message);
    res.status(500).json({
      success: false,
      error: err.message || 'Erro ao desconectar canal.',
    });
  }
}
