/**
 * Webhook WAHA (WhatsApp HTTP API).
 * Eventos suportados:
 *  - message
 *  - session.status
 *
 * Rota: POST /api/channels/webhook/waha
 * Sem auth (rota pública).
 */

import * as channelsRepository from '../repositories/channelsRepository.js';
import * as agentsRepository from '../repositories/agentsRepository.js';
import { processIncomingMessage } from '../services/messagePipeline.js';
import { enqueueConversationTask } from '../services/conversationQueueService.js';
import { sendWhatsAppTextForChannel } from '../services/whatsappOutbound.service.js';
import {
  CONNECTION,
  transitionEvolutionChannelConnection,
} from '../services/channelEvolutionState.service.js';
import { logger } from '../utils/logger.js';
import {
  WHATSAPP_PHASE,
  mergeWhatsappConfig,
  deriveFlowPhase,
} from '../utils/whatsappChannelFlow.js';
import * as inboxRepo from '../repositories/inboxMessages.repository.js';
import * as messageStatusEventsRepo from '../repositories/messageStatusEvents.repository.js';
import { emitChannelSocketEvent } from '../utils/channelRealtime.js';
import { normalizeProviderMessageStatus } from '../utils/normalizeProviderMessageStatus.js';
import { normalizeChannelType, buildConversationId } from '../utils/inboxNormalization.js';

function normalizeBrazilNumber(raw) {
  if (raw == null) return '';
  let n = String(raw).replace(/\D/g, '');
  // Caso BR (55 + DDD(2) + 8 digits => acrescentar 9o dígito após DDD)
  if (n.startsWith('55') && n.length === 12) {
    n = n.slice(0, 4) + '9' + n.slice(4);
  }
  return n;
}

function mapWahaSessionStatusToConnectionStatus(status) {
  const s = String(status || '').trim().toUpperCase();
  if (s === 'WORKING') return CONNECTION.CONNECTED;
  if (s === 'STARTING' || s === 'SCAN_QR_CODE') return CONNECTION.CONNECTING;
  if (s === 'FAILED') return CONNECTION.ERROR;
  if (s === 'STOPPED') return CONNECTION.DISCONNECTED;
  return CONNECTION.DISCONNECTED;
}

export async function handleWahaWebhook(req, res) {
  try {
    const data = req.body;

    if (!data || typeof data !== 'object') {
      console.warn('[WAHA WEBHOOK] corpo inválido');
      return res.sendStatus(200);
    }

    console.log('[WAHA WEBHOOK] recebido', { event: data.event, session: data.session });

    const session = String(data.session || '').trim();
    const event = String(data.event || '').trim();

    if (!session) {
      console.warn('[WAHA WEBHOOK] session ausente');
      return res.sendStatus(200);
    }

    // Segurança básica: validar session/event
    if (!event) {
      console.warn('[WAHA WEBHOOK] event ausente', { event });
      return res.sendStatus(200);
    }

    console.log('[WAHA WEBHOOK]', { session, event, channelId: '(lookup)' });

    const channel = await channelsRepository.findEvolutionChannelByExternalId(session);
    if (!channel) {
      console.warn('[WAHA] Canal não encontrado para session:', session);
      return res.sendStatus(200);
    }
    if (String(channel.provider || '').toLowerCase() !== 'waha') {
      // Evita que um webhook de outra origem/tabuleiro afete canais incompatíveis.
      console.warn('[WAHA] Canal encontrado mas provider != waha', {
        channelId: channel.id,
        provider: channel.provider,
      });
      return res.sendStatus(200);
    }

    const tryApplyMessageStatusUpdate = async (statusPayload) => {
      const externalMessageId =
        statusPayload?.id ||
        statusPayload?.messageId ||
        statusPayload?.msgId ||
        statusPayload?.key?.id ||
        null;
      const normalizedStatus = normalizeProviderMessageStatus('waha', statusPayload?.status || statusPayload?.ack);
      if (!externalMessageId) return false;

      const existing = await inboxRepo.findMessageByExternalId(channel.tenant_id, 'waha', externalMessageId);
      if (!existing) return false;
      const updated = await inboxRepo.updateMessageStatusById(existing.id, normalizedStatus);
      if (!updated) return false;

      await messageStatusEventsRepo.createStatusEvent({
        messageId: updated.id,
        tenantId: updated.tenant_id,
        provider: 'waha',
        eventType: normalizedStatus,
        rawPayload: data,
      });

      const channelType = normalizeChannelType(channel.type);
      emitChannelSocketEvent('message:update', {
        messageId: updated.id,
        tenantId: updated.tenant_id,
        channelId: updated.channel_id,
        channelType,
        conversationId: buildConversationId(updated.channel_id, updated.contact),
        participantId: updated.contact,
        status: normalizedStatus,
      });
      return true;
    };

    if (event === 'message.status' || event === 'message.ack' || event === 'message.any') {
      try {
        await tryApplyMessageStatusUpdate(data.payload || {});
      } catch (statusErr) {
        console.warn('[WAHA] status update failed:', statusErr.message);
      }
      return res.sendStatus(200);
    }

    // ========================================
    // EVENTO: MENSAGEM RECEBIDA
    // ========================================
    if (event === 'message') {
      const payload = data.payload || {};
      const fromRaw = payload.from;
      const messageText =
        payload.body || payload.text || payload.caption || payload.message || '';

      if (!messageText || !fromRaw) {
        console.warn('[WAHA] mensagem inválida (sem body/from)', { fromRawPresent: !!fromRaw });
        return res.sendStatus(200);
      }

      // WAHA usa JID em @c.us
      let from = String(fromRaw).trim();
      if (from.endsWith('@c.us')) from = from.replace('@c.us', '');
      from = normalizeBrazilNumber(from) || from;

      console.log('[WAHA] Mensagem recebida:', { channelId: channel.id, from, len: messageText.length });

      const agentRow = channel.agent_id
        ? await agentsRepository.findById(channel.agent_id)
        : null;
      const agentId = channel.agent_id ?? null;
      const clientId = agentRow?.client_id ?? null;

      const conversationKey = `whatsapp:${from}:${agentId ?? 'null'}`;

      enqueueConversationTask(conversationKey, async () => {
        const result = await processIncomingMessage({
          channel: 'whatsapp',
          senderId: from,
          messageText: messageText,
          timestamp: payload.timestamp ?? payload.timestampMs ?? Date.now(),
          metadata: {
            agentId,
            clientId,
            channelId: channel.id,
            tenantId: channel.tenant_id,
            provider: 'waha',
            session,
          },
        });

        if (result?.replyText) {
          await sendWhatsAppTextForChannel(channel, from, result.replyText);
        }
      });

      console.log('[WAHA] Mensagem processada:', { conversationKey });
      return res.sendStatus(200);
    }

    // ========================================
    // EVENTO: STATUS DA SESSÃO
    // ========================================
    if (event === 'session.status') {
      const payload = data.payload || {};
      const wahaStatus = payload.status;

      const nextConn = mapWahaSessionStatusToConnectionStatus(wahaStatus);
      const prevConn = String(channel.connection_status || '').toLowerCase();

      // Quando connected, limpar artefatos (QR/pairing) no config para manter UI coerente.
      const patch =
        nextConn === CONNECTION.CONNECTED
          ? {
              config: mergeWhatsappConfig(channel.config, {
                phase: WHATSAPP_PHASE.CONNECTED,
                artifact: null,
                artifactType: null,
                artifactUpdatedAt: new Date().toISOString(),
              }),
            }
          : {};

      const tr = await transitionEvolutionChannelConnection({
        channelId: channel.id,
        tenantId: channel.tenant_id,
        channelRow: channel,
        nextConnectionStatus: nextConn,
        evolutionRaw: wahaStatus,
        reason: 'webhook: WAHA session.status',
        source: 'webhook',
        trustRemoteState: true,
        patch,
        force: true,
      });

      if (tr?.applied) {
        logger.statusChange(session, channel.id, prevConn, nextConn);
      }

      console.log('[WAHA] Status atualizado:', { channelId: channel.id, from: prevConn, to: nextConn });
      return res.sendStatus(200);
    }

    // Eventos desconhecidos => ignora de propósito
    return res.sendStatus(200);
  } catch (error) {
    console.error('[WAHA WEBHOOK ERROR]', error);
    return res.sendStatus(500);
  }
}

