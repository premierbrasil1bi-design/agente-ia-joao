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
import { normalizeQrResult } from '../utils/normalizeQrResult.js';
import { pickUnifiedQrTransportFields } from '../utils/whatsappQrContract.js';
import {
  buildWahaQrcodeJsonResponse,
  buildWahaQrcodeSocketPayload,
} from '../utils/wahaQrChannelResponse.js';
import { deriveFlowPhase } from '../utils/whatsappChannelFlow.js';
import { resolveProvider } from '../providers/provider.factory.js';
import { resolveSessionName } from '../utils/resolveSessionName.js';
import { ensureSession } from '../services/sessionOrchestrator.js';
import {
  deriveHealth,
  emitChannelError,
  emitChannelUpdated,
  emitChannelSocketEvent,
} from '../utils/channelRealtime.js';
import { ProviderAccessError } from '../services/providerAccess.service.js';
import * as tenantLimits from '../services/tenantLimits.service.js';
import { sendTenantPlanLimit } from '../utils/tenantPlanLimitHttp.js';
import { assertTenantFeature, TenantFeatureBlockedError } from '../services/tenantFeatures.service.js';
import { sendTenantFeatureForbidden } from '../utils/tenantFeatureHttp.js';

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
    String(err?.message || '').includes('WAHA_API_URL')
  );
}

function resolveChannelSessionName(channel, provider) {
  const providerLc = String(provider || '').toLowerCase();
  if (providerLc === 'waha') return resolveSessionName(channel);
  return (
    String(channel?.external_id || '').trim() ||
    String(channel?.instance || '').trim() ||
    String(channel?.id || '').trim() ||
    'default'
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

    const planOk = await tenantLimits.canConnectChannel(channel.tenant_id, {
      requestId: req.requestId ?? req.correlationId ?? null,
    });
    if (!planOk.allowed) {
      return sendTenantPlanLimit(res, planOk);
    }

    const providerLc = String(resolveProvider(channel) || '').toLowerCase();
    const sessionName = resolveChannelSessionName(channel, providerLc);
    console.log(JSON.stringify({
      event: 'CHANNEL_CONNECT_REQUEST',
      channelId: channel.id,
      tenantId: channel.tenant_id,
      provider: providerLc || null,
      sessionName,
    }));

    try {
      const ensured = await ensureSession({
        provider: providerLc,
        sessionName,
        channelId: channel.id,
        tenantId: channel.tenant_id,
      });
      const latencyMs = Date.now() - startedAt;
      if (ensured?.providerUsed && ensured.providerUsed !== providerLc) {
        console.log(JSON.stringify({
          event: 'SESSION_PROVIDER_SWITCH',
          channelId: channel.id,
          requestedProvider: providerLc,
          providerUsed: ensured.providerUsed,
        }));
      }
      if (ensured?.status === 'WORKING') {
        console.log(JSON.stringify({
          event: 'CHANNEL_CONNECT_SUCCESS',
          channelId: channel.id,
          provider: ensured.providerUsed || providerLc,
          latencyMs,
        }));
        return res.status(200).json({
          success: true,
          status: 'connected',
          provider: ensured.providerUsed || providerLc || null,
          connected: true,
          latencyMs,
        });
      }
      if (ensured?.status === 'QR') {
        console.log(JSON.stringify({
          event: 'CHANNEL_CONNECT_QR',
          channelId: channel.id,
          provider: ensured.providerUsed || providerLc,
          latencyMs,
        }));
        return res.status(200).json({
          success: true,
          status: 'waiting_qr',
          provider: ensured.providerUsed || providerLc || null,
          qrCode: ensured.qr || null,
          qr: ensured.qr || null,
          connected: false,
          latencyMs,
        });
      }
    } catch (orchestratorErr) {
      console.warn('[channelConnection] ensureSession fallback legado:', orchestratorErr?.message || orchestratorErr);
    }

    const result = await channelConnectionService.connectWhatsAppChannel(channel, {
      correlationId: req.correlationId ?? null,
    });

    const { artifactType, artifact } = extractConnectArtifactFromPayload(result.connectResponse);
    const flowPhase = deriveFlowPhase(result.channel);

    const latencyMs = Date.now() - startedAt;
    console.log(JSON.stringify({
      event: 'CHANNEL_CONNECT_SUCCESS',
      channelId: result.channel.id,
      provider: resolveProvider(result.channel) || providerLc || null,
      latencyMs,
    }));
    return res.status(200).json({
      success: true,
      channelId: result.channel.id,
      provider: resolveProvider(result.channel) || providerLc || null,
      providerUsed: resolveProvider(result.channel) || providerLc || null,
      instance: result.instanceName,
      status: flowPhase,
      artifactType,
      artifact,
      channel: result.channel,
      correlationId: result.connectResponse?.correlationId ?? req.correlationId ?? null,
      connectCanonical: result.connectResponse?.canonical ?? null,
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
    console.log(JSON.stringify({
      event: 'CHANNEL_CONNECT_FAIL',
      channelId: channelRef?.id || null,
      provider: channelRef ? resolveProvider(channelRef) : null,
      code: err.code || err.response?.status || null,
    }));
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
    return res.status(500).json({
      success: false,
      error: 'Erro ao conectar canal.',
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
    const sessionName = resolveChannelSessionName(channel, providerLc);
    const ensured = await ensureSession({
      provider: providerLc,
      sessionName,
      channelId: channel.id,
      tenantId: channel.tenant_id,
    });
    if (ensured?.providerUsed && ensured.providerUsed !== providerLc) {
      console.log(JSON.stringify({
        event: 'SESSION_PROVIDER_SWITCH',
        channelId: channel.id,
        requestedProvider: providerLc,
        providerUsed: ensured.providerUsed,
      }));
    }
    if (ensured?.status === 'WORKING' && !ensured?.qr) {
      return res.status(200).json({
        success: true,
        provider: ensured.providerUsed || provider,
        status: 'CONNECTED',
        connected: true,
        message: 'Sessão já conectada.',
      });
    }
    if (ensured?.status === 'QR' && ensured?.qr) {
      return res.status(200).json({
        success: true,
        format: String(ensured.qr).startsWith('data:image') ? 'image' : 'ascii',
        qr: ensured.qr,
        qrCode: ensured.qr,
        qrcode: ensured.qr,
        provider: ensured.providerUsed || provider,
        status: 'PENDING',
      });
    }

    const cid = req.correlationId ?? null;
    const qr = await channelConnectionService.getChannelQrCode(channel, { correlationId: cid });
    const result = normalizeQrResult(qr);

    const socketPayload = {
      channelId: channel.id,
      tenantId: channel.tenant_id,
      status: 'PENDING',
      format: result.format,
      qr: result.qr,
      qrCode: result.format === 'image' ? result.qr : null,
      qrAscii: result.format === 'ascii' ? result.qr : null,
      connected: false,
      correlationId: result.correlationId ?? cid,
      ...pickUnifiedQrTransportFields(result),
    };

    if (providerLc === 'waha') {
      const wahaSocket = buildWahaQrcodeSocketPayload(channel, result, cid);
      emitChannelSocketEvent('channel:qr', wahaSocket);
      console.log('[CHANNEL SOCKET] channel:qr (waha)', {
        id: channel.id,
        state: wahaSocket.state,
      });
      return res.status(200).json(buildWahaQrcodeJsonResponse(result, cid));
    }

    if (!result.success || !result.qr) {
      return res.status(404).json({
        success: false,
        format: null,
        qr: null,
        error: 'QR não disponível ainda',
        message: result.message || 'QR não disponível ainda',
      });
    }

    const outQr = result.qr;
    res.status(200).json({
      success: true,
      format: result.format,
      qr: outQr,
      qrCode: outQr,
      qrcode: outQr,
      provider,
      status: 'PENDING',
      message: result.message ?? null,
    });
    emitChannelSocketEvent('channel:qr', socketPayload);
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
        message: 'WAHA não configurado no servidor (defina WAHA_API_URL).',
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
    const result = await channelConnectionService.getChannelStatus(channel, {
      correlationId: req.correlationId ?? null,
    });

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

    const correlationId =
      result.sessionStatusCanonical?.correlationId ?? req.correlationId ?? null;
    const sessionStatus = result.sessionStatusCanonical ?? null;
    const legacyPayload = {
      channelId: channel.id,
      tenantId: channel.tenant_id,
      status: normalizedRealtimeStatus,
      qrCode: null,
      connected: normalizedRealtimeStatus === 'CONNECTED',
    };
    emitChannelSocketEvent('channel:status', {
      ...legacyPayload,
      sessionStatus,
      correlationId,
      version: 'v2',
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
      correlationId: result.sessionStatusCanonical?.correlationId ?? req.correlationId ?? null,
      sessionStatus: result.sessionStatusCanonical ?? null,
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
    if (err instanceof TenantFeatureBlockedError) {
      return sendTenantFeatureForbidden(res, err);
    }
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
