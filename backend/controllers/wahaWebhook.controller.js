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
import { processIncomingMessage } from '../services/messagePipeline.js';
import { enqueueConversationTask } from '../services/conversationQueueService.js';
import { sendMessage as sendWahaMessage } from '../services/wahaService.js';
import { resolveAgentForChannel } from '../services/agentRouter.js';
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

function parseWahaIncoming(payload = {}) {
  const fromRaw = payload.from ?? payload.key?.remoteJid ?? payload.chatId ?? '';
  const textRaw =
    payload.body ??
    payload.text ??
    payload.caption ??
    payload.message?.conversation ??
    payload.message?.extendedTextMessage?.text ??
    payload.message ??
    '';
  const fromMe = Boolean(
    payload.fromMe ??
      payload.key?.fromMe ??
      payload.message?.key?.fromMe ??
      payload?.participant?.includes?.('@g.us-self'),
  );
  let from = String(fromRaw || '').trim();
  if (from.endsWith('@c.us')) from = from.replace('@c.us', '');
  const messageText = typeof textRaw === 'string' ? textRaw.trim() : '';
  return {
    from,
    messageText,
    fromMe,
  };
}

function resolveWahaSession(data = {}) {
  const raw = String(data.session || data.instance || data.sessionName || '').trim();
  if (raw) return raw;
  // WAHA free/core normalmente usa sessão fixa "default".
  return 'default';
}

export async function handleWahaWebhook(req, res) {
  try {
    const data = req.body;

    if (!data || typeof data !== 'object') {
      console.warn('[WAHA WEBHOOK] corpo inválido');
      return res.sendStatus(200);
    }

    console.log('[WAHA WEBHOOK] recebido', { event: data.event, session: data.session });

    const session = resolveWahaSession(data);
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

    // ========================================
    // EVENTO: MENSAGEM RECEBIDA
    // ========================================
    if (event === 'message') {
      const payload = data.payload || {};
      const parsed = parseWahaIncoming(payload);
      if (parsed.fromMe) {
        console.log('[WAHA] Ignorando mensagem própria');
        return res.sendStatus(200);
      }

      if (!parsed.messageText || !parsed.from) {
        console.warn('[WAHA] mensagem inválida (sem body/from)', {
          fromRawPresent: Boolean(parsed.from),
          bodyPresent: Boolean(parsed.messageText),
        });
        return res.sendStatus(200);
      }

      // WAHA usa JID em @c.us
      let from = parsed.from;
      from = normalizeBrazilNumber(from) || from;
      const messageText = parsed.messageText;

      console.log('[WAHA] Session:', session);
      console.log(`[WAHA] Incoming message from ${from}: "${messageText}"`);

      const agent = await resolveAgentForChannel('whatsapp', session);
      if (!agent?.agentId) {
        console.warn('[WAHA] Agent not found:', session);
        return res.sendStatus(200);
      }
      console.log('[WAHA] Agent resolved:', agent.agentId);

      const conversationKey = `whatsapp:${from}:${agent.agentId ?? 'null'}`;

      enqueueConversationTask(conversationKey, async () => {
        const result = await processIncomingMessage({
          channel: 'whatsapp',
          senderId: from,
          messageText: messageText,
          timestamp: payload.timestamp ?? payload.timestampMs ?? Date.now(),
          metadata: {
            agentId: agent.agentId,
            clientId: agent.clientId,
            channelId: agent.channelId,
            provider: 'waha',
            session,
          },
        });

        const aiResponse = result?.replyText != null ? String(result.replyText).trim() : '';
        if (!aiResponse) {
          console.warn('[WAHA] Empty AI response');
          return;
        }

        console.log('[WAHA] AI response:', aiResponse);
        const sent = await sendWahaMessage(session, from, aiResponse, {
          channelId: agent.channelId,
        });
        if (!sent?.ok) {
          console.error('[WAHA] sendText failed', sent?.error || sent);
        } else {
          console.log('[WAHA] Response sent');
        }
      });

      console.log('[WAHA] Mensagem processada:', { conversationKey });
      return res.sendStatus(200);
    }

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

