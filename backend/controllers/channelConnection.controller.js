/**
 * Controller: conexão de canais WhatsApp (Evolution API).
 * Rotas: POST /:id/connect, GET /:id/qrcode, GET /:id/status, POST /:id/disconnect
 */

import * as channelRepo from '../repositories/channel.repository.js';
import * as channelConnectionService from '../services/channelConnection.service.js';
import { sendNotFound } from '../utils/errorResponses.js';

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

export async function connectChannel(req, res) {
  try {
    const channel = await getChannelFromReq(req, res);
    if (!channel) return;

    const instanceName = await channelConnectionService.connectWhatsAppChannel(channel);

    res.status(200).json({
      success: true,
      instance: instanceName,
    });
  } catch (err) {
    console.error('[channelConnection] connectChannel:', err.message);
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

    const qr = await channelConnectionService.getChannelQrCode(channel);
    res.status(200).json({
      success: true,
      qrcode: qr,
    });
  } catch (err) {
    console.error('[channelConnection] getQrCode:', err.message);
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

    const { state, channel: updatedChannel } = await channelConnectionService.getChannelStatus(channel);

    res.status(200).json({
      success: true,
      status: state?.state ?? state?.instance?.state ?? null,
      channel: updatedChannel,
    });
  } catch (err) {
    console.error('[channelConnection] getStatus:', err.message);
    res.status(500).json({
      success: false,
      error: err.message || 'Erro ao obter status.',
    });
  }
}

export async function disconnectChannel(req, res) {
  try {
    const channel = await getChannelFromReq(req, res);
    if (!channel) return;

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
