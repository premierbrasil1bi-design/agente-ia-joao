/**
 * Controller: conexão de canais WhatsApp (Evolution API).
 * Rotas: POST /:id/connect, GET /:id/qrcode, GET /:id/status, POST /:id/disconnect
 */

import * as channelRepo from '../repositories/channel.repository.js';
import * as channelConnectionService from '../services/channelConnection.service.js';
import { sendNotFound } from '../utils/errorResponses.js';
import {
  extractConnectArtifactFromPayload,
} from '../services/channelConnection.service.js';
import { sendWhatsAppTextForChannel } from '../services/whatsappOutbound.service.js';
import { extractQrPayload, toQrDataUrl } from '../utils/extractQrPayload.js';
import { deriveFlowPhase } from '../utils/whatsappChannelFlow.js';
import { resolveProvider } from '../providers/provider.factory.js';
import {
  deriveHealth,
  emitChannelError,
  emitChannelUpdated,
  emitChannelSocketEvent,
} from '../utils/channelRealtime.js';
import { ProviderAccessError } from '../services/providerAccess.service.js';
import { getCurrentQr as getWahaDockerLogQr, isWahaQrLogCaptureEnabled } from '../services/wahaQrCapture.js';

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

function isWahaAuthError(err) {
  return err?.httpStatus === 401 || String(err?.message || '').includes('WAHA authentication failed');
}

function isWahaNotConfiguredMessage(err) {
  return (
    String(err?.message || '').includes('WAHA não configurado') ||
    String(err?.message || '').includes('WAHA_API_URL') ||
    String(err?.message || '').includes('WAHA_API_KEY')
  );
}

export async function sendChannelMessage(req, res) {
  try {
    const channel = await getChannelFromReq(req, res);
    if (!channel) return;

    const { number, text } = req.body || {};
    if (number == null || String(number).trim() === '' || text == null || String(text).trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Informe number e text no corpo da requisição.',
      });
    }

    await sendWhatsAppTextForChannel(channel, String(number).trim(), String(text));
    return res.status(200).json({ success: true });
  } catch (err) {
    if (
      err instanceof ProviderAccessError ||
      err?.code === 'NO_ALLOWED_PROVIDER_AVAILABLE' ||
      err?.code === 'MESSAGE_LIMIT_EXCEEDED'
    ) {
      const status =
        err.httpStatus || (err?.code === 'MESSAGE_LIMIT_EXCEEDED' ? 429 : 403);
      return res.status(status).json({
        success: false,
        error: err.code || 'PROVIDER_NOT_ALLOWED',
        message: err.message,
        details: err.details || null,
      });
    }
    console.error('[channelConnection] sendChannelMessage:', err.message);
    return res.status(500).json({
      success: false,
      error: err.message || 'Erro ao enviar mensagem.',
    });
  }
}

export async function connectChannel(req, res) {
  const startedAt = Date.now();
  let channelRef = null;
  try {
    const channel = await getChannelFromReq(req, res);
    if (!channel) return;
    channelRef = channel;

    const providerLc = resolveProvider(channel);
    const result = await channelConnectionService.connectWhatsAppChannel(channel);

    const { artifactType, artifact } = extractConnectArtifactFromPayload(result.connectResponse);
    const flowPhase = deriveFlowPhase(result.channel);

    const latencyMs = Date.now() - startedAt;
    res.status(200).json({
      success: true,
      channelId: result.channel.id,
      provider: resolveProvider(result.channel) || providerLc || null,
      providerUsed: resolveProvider(result.channel) || providerLc || null,
      instance: result.instanceName,
      status: flowPhase,
      artifactType,
      artifact,
      channel: result.channel,
      skippedDueToCooldown: Boolean(result.connectResponse?.skippedDueToCooldown),
      latencyMs,
      health: deriveHealth(result.channel?.connection_status || flowPhase, latencyMs, false),
      ...(result.connectResponse?.skippedDueToCooldown
        ? {
            message:
              'A conexão do WhatsApp ainda está aguardando QR ou código. Aguarde alguns segundos antes de tentar de novo.',
          }
        : {}),
    });
  } catch (err) {
    if (err instanceof ProviderAccessError || err?.code === 'NO_ALLOWED_PROVIDER_AVAILABLE') {
      return res.status(err.httpStatus || 403).json({
        success: false,
        error: err.code || 'PROVIDER_NOT_ALLOWED',
        message: err.message,
        details: err.details || null,
      });
    }
    console.error('[channelConnection] connectChannel:', err.message, err.response?.status || err.code || '');
    emitChannelError(channelRef, err, { operation: 'connectChannel' });
    if (err.code === 'INSTANCE_NOT_FOUND') {
      return res.status(200).json({
        success: false,
        error: true,
        message: err.userMessage || err.message || 'Instance not created',
        code: 'INSTANCE_NOT_FOUND',
      });
    }
    if (err.code === 'NO_PROVIDER_AVAILABLE' || err.message === 'NO_PROVIDER_AVAILABLE') {
      return res.status(503).json({
        success: false,
        error: 'NO_PROVIDER_AVAILABLE',
        details:
          err.details && typeof err.details === 'object'
            ? err.details
            : { tried: [], statuses: {} },
      });
    }
    if (err.message && String(err.message).includes('Provider não suportado')) {
      return res.status(400).json({
        success: false,
        error: err.message,
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
      context: {
        code: err.code || err.response?.status || null,
        timeout: Boolean(err.code === 'ETIMEDOUT' || err.code === 'ECONNABORTED'),
        auth: err.response?.status === 401 || err.response?.status === 403,
      },
    });
  }
}

export async function getQrCode(req, res) {
  let channel = null;
  try {
    channel = await getChannelFromReq(req, res);
    if (!channel) return;

    const provider = resolveProvider(channel);
    const providerLc = String(provider || '').toLowerCase();
    let qr;
    try {
      qr = await channelConnectionService.getChannelQrCode(channel);
    } catch (fetchErr) {
      if (
        providerLc === 'waha' &&
        isWahaQrLogCaptureEnabled() &&
        getWahaDockerLogQr()
      ) {
        qr = getWahaDockerLogQr();
      } else {
        throw fetchErr;
      }
    }
    let raw = extractQrPayload(qr);
    let dataUrl = toQrDataUrl(raw);
    if (
      !dataUrl &&
      providerLc === 'waha' &&
      isWahaQrLogCaptureEnabled() &&
      getWahaDockerLogQr()
    ) {
      dataUrl = toQrDataUrl(getWahaDockerLogQr());
    }

    if (!dataUrl) {
      return res.status(404).json({
        success: false,
        error: 'QR não disponível ainda',
      });
    }
    res.status(200).json({
      success: true,
      provider,
      qrCode: dataUrl,
      qr: dataUrl,
      qrcode: dataUrl,
      status: 'PENDING',
    });
    emitChannelSocketEvent('channel:qr', {
      channelId: channel.id,
      tenantId: channel.tenant_id,
      status: 'PENDING',
      qrCode: dataUrl,
      connected: false,
    });
    console.log('[CHANNEL SOCKET] QR emitted', { id: channel.id, tenantId: channel.tenant_id });
  } catch (err) {
    if (err instanceof ProviderAccessError || err?.code === 'NO_ALLOWED_PROVIDER_AVAILABLE') {
      return res.status(err.httpStatus || 403).json({
        success: false,
        error: err.code || 'PROVIDER_NOT_ALLOWED',
        message: err.message,
        details: err.details || null,
      });
    }
    console.error('[channelConnection] getQrCode:', err.message, err.response?.status || err.code || '');
    if (err.message && String(err.message).includes('Provider não suportado')) {
      return res.status(400).json({
        success: false,
        error: err.message,
      });
    }
    if (isWahaAuthError(err)) {
      return res.status(401).json({
        success: false,
        error: 'WAHA_AUTH_FAILED',
        message: err.message || 'API key WAHA inválida ou ausente.',
      });
    }
    if (isWahaNotConfiguredMessage(err)) {
      return res.status(503).json({
        success: false,
        error: 'WAHA_NOT_CONFIGURED',
        message: 'WAHA não configurado no servidor (defina WAHA_API_URL e WAHA_API_KEY).',
      });
    }
    if (String(err.message || '') === 'QR não disponível') {
      return res.status(404).json({
        success: false,
        error: 'QR_NOT_READY',
        message: 'QR ainda não disponível. Inicie a sessão ou tente novamente em instantes.',
      });
    }
    if (err.code === 'INSTANCE_NOT_FOUND') {
      return res.status(404).json({
        success: false,
        error: err.code,
        message: err.userMessage || err.message || 'Instância não encontrada.',
      });
    }
    if (isEvolutionOffline(err)) {
      return res.status(503).json({
        success: false,
        error: 'Evolution API está offline ou inacessível.',
      });
    }
    res.status(502).json({
      success: false,
      error: err.message || 'Erro ao obter QR Code.',
    });
  }
}

export async function getStatus(req, res) {
  const startedAt = Date.now();
  let channelRef = null;
  try {
    const channel = await getChannelFromReq(req, res);
    if (!channel) return;
    channelRef = channel;

    console.log('[WHATSAPP_STATUS] check', { channelId: channel.id, tenantId: channel.tenant_id });
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
        publicStatus: 'inactive',
        evolutionOffline: true,
        message: 'Serviço temporariamente indisponível',
      });
    }

    const rawState = result.state?.status ?? result.state?.state ?? result.state?.instance?.state ?? null;
    const publicStatus = result.publicStatus ?? result.normalizedStatus;
    const normalizedRealtimeStatus =
      String(publicStatus || '').toLowerCase() === 'connected'
        ? 'CONNECTED'
        : String(publicStatus || '').toLowerCase() === 'awaiting_connection'
          ? 'PENDING'
          : 'DISCONNECTED';
    let userMessage = null;
    const ps = String(publicStatus || '').toLowerCase();
    if (ps === 'connected') userMessage = 'Canal já conectado.';
    else if (ps === 'awaiting_connection') {
      userMessage = 'A conexão do WhatsApp ainda está aguardando QR ou código.';
    }

    const ch = result.channel;
    const connectionStatus =
      ch && typeof ch === 'object' && ch.connection_status != null
        ? String(ch.connection_status)
        : null;

    const latencyMs = Date.now() - startedAt;
    const derived = deriveHealth(result.channel?.connection_status || result.normalizedStatus, latencyMs, false);
    emitChannelUpdated(result.channel || channel, {
      source: 'status.poll',
      latencyMs,
      health: derived,
    });

    emitChannelSocketEvent('channel:status', {
      channelId: channel.id,
      tenantId: channel.tenant_id,
      status: normalizedRealtimeStatus,
      qrCode: null,
      connected: normalizedRealtimeStatus === 'CONNECTED',
    });
    console.log('[CHANNEL SOCKET] STATUS emitted', {
      id: channel.id,
      tenantId: channel.tenant_id,
      status: normalizedRealtimeStatus,
    });
    if (normalizedRealtimeStatus === 'CONNECTED') {
      emitChannelSocketEvent('channel:connected', {
        channelId: channel.id,
        tenantId: channel.tenant_id,
        status: 'CONNECTED',
        qrCode: null,
        connected: true,
      });
      console.log('[CHANNEL SOCKET] CONNECTED emitted', { id: channel.id, tenantId: channel.tenant_id });
    }

    res.status(200).json({
      success: true,
      provider: resolveProvider(result.channel || channel),
      connected: normalizedRealtimeStatus === 'CONNECTED',
      status: result.normalizedStatus,
      connection_status: connectionStatus,
      normalizedStatus: result.normalizedStatus,
      publicStatus,
      userMessage,
      evolutionState: rawState,
      channel: result.channel,
      recreated: Boolean(result.recreated),
      latencyMs,
      health: derived,
    });
  } catch (err) {
    if (err instanceof ProviderAccessError || err?.code === 'NO_ALLOWED_PROVIDER_AVAILABLE') {
      return res.status(err.httpStatus || 403).json({
        success: false,
        error: err.code || 'PROVIDER_NOT_ALLOWED',
        message: err.message,
        details: err.details || null,
      });
    }
    console.error('[channelConnection] getStatus:', err.message, err.response?.status || err.code || '');
    emitChannelError(channelRef, err, { operation: 'getStatus' });
    return res.status(200).json({
      success: true,
      status: 'disconnected',
      normalizedStatus: 'offline',
      evolutionOffline: true,
      message: 'Serviço temporariamente indisponível',
      health: 'offline',
    });
  }
}

export async function getConnectionArtifact(req, res) {
  try {
    const channel = await getChannelFromReq(req, res);
    if (!channel) return;

    console.log('[WHATSAPP_ARTIFACT] GET handler', {
      channelId: channel.id,
      tenantId: channel.tenant_id,
    });
    const out = await channelConnectionService.getChannelConnectionArtifact(channel);

    if (out.status === 'connected') {
      return res.status(200).json({
        success: true,
        ...out,
        message: 'Canal já conectado.',
      });
    }

    if (out.status === 'error') {
      return res.status(200).json({
        success: false,
        error: true,
        message: 'Não foi possível obter o artefato de conexão.',
        ...out,
      });
    }

    if (!out.artifact && out.status === 'awaiting_connection') {
      return res.status(200).json({
        success: true,
        ...out,
        message: 'A conexão do WhatsApp ainda está aguardando QR ou código.',
      });
    }

    res.status(200).json({ success: true, ...out });
  } catch (err) {
    if (err instanceof ProviderAccessError || err?.code === 'NO_ALLOWED_PROVIDER_AVAILABLE') {
      return res.status(err.httpStatus || 403).json({
        success: false,
        error: err.code || 'PROVIDER_NOT_ALLOWED',
        message: err.message,
        details: err.details || null,
      });
    }
    console.error('[channelConnection] getConnectionArtifact:', err.message);
    if (isEvolutionOffline(err)) {
      return res.status(503).json({
        success: false,
        error: 'Evolution API está offline ou inacessível.',
      });
    }
    res.status(500).json({
      success: false,
      error: err.message || 'Erro ao obter artefato de conexão.',
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
      provider: resolveProvider(channel),
      disconnected: true,
      message: 'Canal desconectado.',
    });
  } catch (err) {
    if (err instanceof ProviderAccessError || err?.code === 'NO_ALLOWED_PROVIDER_AVAILABLE') {
      return res.status(err.httpStatus || 403).json({
        success: false,
        error: err.code || 'PROVIDER_NOT_ALLOWED',
        message: err.message,
        details: err.details || null,
      });
    }
    console.error('[channelConnection] disconnectChannel:', err.message);
    res.status(500).json({
      success: false,
      error: err.message || 'Erro ao desconectar canal.',
    });
  }
}
