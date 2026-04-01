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
import * as whatsappEngine from '../services/whatsappEngine.js';
import {
  getProvider,
  getProviderForChannel,
  mergeProviderConfigForConnect,
  resolveProvider,
} from '../providers/provider.factory.js';
import { deriveHealth, emitChannelError, emitChannelUpdated } from '../utils/channelRealtime.js';
import { getResolvedWahaUrl, isWahaUnreachableError } from '../services/wahaService.js';
import { getProvidersHealthSnapshot } from '../services/providerHealth.service.js';

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

function normalizeProviderCandidates(channel, preferred) {
  const fallback = Array.isArray(channel?.fallback_providers) ? channel.fallback_providers : [];
  const normalizedFallback = fallback.map((p) => String(p || '').toLowerCase().trim()).filter(Boolean);
  const ordered = [preferred, ...normalizedFallback].filter(Boolean);
  return [...new Set(ordered)];
}

function buildChannelForProvider(channel, providerName) {
  const cfg = channel?.provider_config && typeof channel.provider_config === 'object' ? channel.provider_config : {};
  return {
    ...channel,
    provider: providerName,
    provider_config: { ...cfg, type: providerName },
  };
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

    console.log('[CONNECT_CHANNEL] channelId:', channel.id, 'tenantId:', channel.tenant_id);
    const providerLc = resolveProvider(channel);
    const isWhatsapp = String(channel.type || '').toLowerCase() === 'whatsapp';
    const providerCfg = mergeProviderConfigForConnect(channel);
    const instanceName =
      providerCfg.instance || providerCfg.instanceName || channel.external_id || channel.instance || null;
    console.log('CONNECT CHANNEL ID:', channel.id);
    console.log('CHANNEL DATA:', {
      id: channel.id,
      provider: channel.provider,
      type: channel.type,
      external_id: channel.external_id,
      instance: channel.instance,
    });
    console.log('INSTANCE:', instanceName);
    console.log('PROVIDER:', providerLc);
    if (providerLc === 'waha') {
      try {
        console.log('[WAHA] URL:', getResolvedWahaUrl());
      } catch {
        console.log('[WAHA] URL: (indisponível na config)');
      }
    }
    if (isWhatsapp) {
      console.log('[CONNECT]');
      if (!providerLc) {
        return res.status(400).json({
          success: false,
          error: 'Provider não definido no canal. Defina provider ou provider_config.type.',
        });
      }
      const candidates = normalizeProviderCandidates(channel, providerLc);
      const snapshot = await getProvidersHealthSnapshot();
      const preferredState = snapshot[providerLc]?.status || null;
      if (preferredState === 'degraded') {
        console.log('[FAILOVER]', { from: providerLc, to: providerLc, reason: 'provider degraded' });
      }
      const ordered = candidates.filter((p) => snapshot[p]?.status !== 'down');

      let qr = null;
      let providerUsed = null;
      let providerCfgUsed = null;
      let lastErr = null;
      const statusMap = Object.fromEntries(candidates.map((p) => [p, snapshot[p]?.status || 'unknown']));
      const tried = [];

      if (ordered.length === 0) {
        const e = new Error('NO_PROVIDER_AVAILABLE');
        e.code = 'NO_PROVIDER_AVAILABLE';
        e.details = { tried, statuses: statusMap };
        throw e;
      }

      let previousProvider = providerLc;
      for (const providerName of ordered) {
        tried.push(providerName);
        if (providerName !== previousProvider) {
          const reason = lastErr ? 'provider error' : 'provider down / degraded';
          console.log('[FAILOVER]', { from: previousProvider, to: providerName, reason });
        }
        try {
          const providerChannel = buildChannelForProvider(channel, providerName);
          const providerCfg = mergeProviderConfigForConnect(providerChannel);
          const providerInstance =
            providerName === providerLc ? getProviderForChannel(channel) : getProvider(providerName, providerCfg);
          await providerInstance.connect();
          qr = await providerInstance.getQRCode();
          providerUsed = providerName;
          providerCfgUsed = providerCfg;
          break;
        } catch (e) {
          lastErr = e;
          previousProvider = providerName;
          console.error('[FAILOVER] connect provider failed', {
            provider: providerName,
            message: e?.message || 'unknown_error',
          });
        }
      }
      if (!providerUsed) {
        const e = lastErr || new Error('NO_PROVIDER_AVAILABLE');
        if (!e.code) e.code = 'NO_PROVIDER_AVAILABLE';
        if (!e.details) e.details = { tried, statuses: statusMap };
        throw e;
      }
      console.log('[QR RECEIVED]', !!qr);
      const patch = {
        provider: providerUsed,
        connection_status: qr ? 'connecting' : 'connected',
        last_error: null,
      };
      if (providerUsed === 'waha' && providerCfgUsed?.session) {
        patch.external_id = providerCfgUsed.session;
        patch.instance = providerCfgUsed.session;
      }
      const updated = await channelRepo.updateConnection(channel.id, channel.tenant_id, patch);
      const latencyMs = Date.now() - startedAt;
      emitChannelUpdated(updated || channel, {
        source: 'connect.provider_factory',
        latencyMs,
        health: deriveHealth(updated?.connection_status || (qr ? 'connecting' : 'connected'), latencyMs, false),
      });
      const refreshed = await channelRepo.findById(channel.id, channel.tenant_id);
      return res.status(200).json({
        success: true,
        channelId: channel.id,
        provider: providerUsed,
        providerUsed,
        qr: qr || null,
        qrcode: qr || null,
        channel: refreshed || channel,
        status: qr ? 'connecting' : 'connected',
        latencyMs,
        health: deriveHealth(qr ? 'connecting' : 'connected', latencyMs, false),
      });
    }

    // Fallback legado para canais não-WhatsApp ou fluxos antigos.
    const shouldUseEngine =
      providerLc && ['waha', 'evolution', 'zapi'].includes(providerLc);
    if (shouldUseEngine) {
      const out = await whatsappEngine.connectChannel(channel);
      const refreshed = await channelRepo.findById(channel.id, channel.tenant_id);
      const latencyMs = Date.now() - startedAt;
      return res.status(200).json({
        success: true,
        channelId: channel.id,
        provider: out.provider,
        providerUsed: out.provider,
        qr: out.qr || null,
        qrcode: out.qr || null,
        channel: refreshed || channel,
        status: out.connected ? 'connected' : 'connecting',
        latencyMs,
        health: deriveHealth(out.connected ? 'connected' : 'connecting', latencyMs, false),
      });
    }

    const result = await channelConnectionService.connectWhatsAppChannel(channel);

    const { artifactType, artifact } = extractConnectArtifactFromPayload(result.connectResponse);
    const flowPhase = deriveFlowPhase(result.channel);

    const latencyMs = Date.now() - startedAt;
    res.status(200).json({
      success: true,
      channelId: result.channel.id,
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
    if (err.httpStatus === 401) {
      return res.status(401).json({
        success: false,
        error: err.message || 'WAHA: API Key inválida ou ausente.',
      });
    }
    if (channelRef && /WAHA_API_URL|WAHA_API_KEY/.test(err.message || '')) {
      return res.status(500).json({
        success: false,
        error: err.message,
        code: 'WAHA_CONFIG',
      });
    }
    if (isEvolutionOffline(err)) {
      return res.status(503).json({
        success: false,
        error: 'Evolution API está offline ou inacessível. Verifique o container/serviço e a variável EVOLUTION_API_URL.',
      });
    }
    if (
      channelRef &&
      resolveProvider(channelRef) === 'waha' &&
      (err.code === 'WAHA_UNREACHABLE' || isWahaUnreachableError(err))
    ) {
      return res.status(503).json({
        success: false,
        error:
          'WAHA está offline ou inacessível. Verifique WAHA_API_URL e se o serviço está em execução.',
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

    const isWhatsapp = String(channel.type || '').toLowerCase() === 'whatsapp';
    const providerLc = resolveProvider(channel);
    if (isWhatsapp && ['waha', 'evolution', 'zapi', 'official', 'whatsapp_oficial'].includes(providerLc)) {
      let provider;
      try {
        provider = getProviderForChannel(channel);
      } catch (e) {
        return res.status(400).json({
          success: false,
          error: e.message || 'Provider inválido.',
        });
      }
      const qr = await provider.getQRCode();
      console.log('[PROVIDER]', providerLc);
      console.log('[QR RECEIVED]', !!qr);
      return res.status(200).json({
        success: true,
        qr,
        qrcode: qr,
      });
    }

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
    if (err.message && String(err.message).includes('Provider não suportado')) {
      return res.status(400).json({
        success: false,
        error: err.message,
      });
    }
    if (err.httpStatus === 401) {
      return res.status(401).json({
        success: false,
        error: err.message || 'WAHA: API Key inválida ou ausente.',
      });
    }
    if (channel && /WAHA_API_URL|WAHA_API_KEY/.test(err.message || '')) {
      return res.status(500).json({
        success: false,
        error: err.message,
        code: 'WAHA_CONFIG',
      });
    }
    if (isEvolutionOffline(err)) {
      return res.status(503).json({
        success: false,
        error: 'Evolution API está offline ou inacessível.',
      });
    }
    if (channel && resolveProvider(channel) === 'waha' && (err.code === 'WAHA_UNREACHABLE' || isWahaUnreachableError(err))) {
      return res.status(503).json({
        success: false,
        error: 'WAHA está offline ou inacessível.',
      });
    }
    res.status(500).json({
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

    const rawState = result.state?.state ?? result.state?.instance?.state ?? null;
    const publicStatus = result.publicStatus ?? result.normalizedStatus;
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

    res.status(200).json({
      success: true,
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
