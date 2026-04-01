/**
 * Central message pipeline – all channels (WhatsApp, web, telegram, etc.) flow through here.
 * Steps: resolve context → load prompt → generate response → persist → return reply.
 */

import * as contextService from './contextService.js';
import * as promptsRepo from '../repositories/promptsRepository.js';
import * as channelsRepo from '../repositories/channelsRepository.js';
import * as messagesRepo from '../repositories/messagesRepository.js';
import * as openaiService from './openaiService.js';
import * as conversationMemoryService from './conversationMemoryService.js';
import * as userMemoryService from './userMemoryService.js';
import * as semanticMemoryService from './semanticMemoryService.js';
import * as messageEmbeddingsRepo from '../repositories/messageEmbeddingsRepository.js';
import * as inboxRepo from '../repositories/inboxMessages.repository.js';
import * as messageStatusEventsRepo from '../repositories/messageStatusEvents.repository.js';
import { extractAndStoreFacts } from './memoryExtractionService.js';
import AgentCore from '../agents/AgentCore.js';
import { emitMessageEvent } from '../utils/channelRealtime.js';
import { buildConversationId, normalizeChannelType } from '../utils/inboxNormalization.js';

const MIN_CONTENT_LENGTH_FOR_EMBEDDING = 1;
const MAX_CONTENT_LENGTH_FOR_EMBEDDING = 8000;

const DEFAULT_SYSTEM_MESSAGE =
  'Você é um assistente prestativo. Responda em português de forma clara e objetiva.';

/**
 * Process an incoming message through the central pipeline.
 *
 * @param {object} incomingMessage
 * @param {string} incomingMessage.channel - e.g. "whatsapp", "web"
 * @param {string} incomingMessage.senderId - channel-specific sender id (e.g. JID, user id)
 * @param {string} incomingMessage.messageText - raw text from user
 * @param {number} [incomingMessage.timestamp] - optional timestamp
 * @param {object} [incomingMessage.metadata] - optional; may include agentId, clientId, etc.
 * @returns {Promise<{ replyText: string }>}
 */
export async function processIncomingMessage(incomingMessage) {
  const {
    channel = 'web',
    senderId,
    messageText,
    timestamp,
    metadata = {},
  } = incomingMessage;

  if (!messageText || typeof messageText !== 'string') {
    return { replyText: 'Mensagem não reconhecida.' };
  }

  const clientId = metadata.clientId ?? null;
  const agentId = metadata.agentId ?? process.env.DEFAULT_AGENT_ID ?? null;

  // Step 1 — resolve agent context
  let ctx = {
    client_id: clientId,
    agent_id: agentId,
    channel: (channel || 'web').toString().toUpperCase(),
    prompt_id: null,
    canal_nome: (channel || 'WEB').toString().toUpperCase(),
  };

  if (agentId) {
    try {
      ctx = await contextService.getContext(clientId, agentId, channel);
    } catch (err) {
      console.error('[messagePipeline] getContext error:', err.message);
    }
  }

  // Resolve channelId once (for prompt, history, persist)
  let channelId = null;
  const channelLower = (channel || 'web').toString().toLowerCase();
  if (ctx.agent_id) {
    try {
      const channels = await channelsRepo.findByAgentId(ctx.agent_id);
      const channelRow = channels.find((c) => (c.type || '').toLowerCase() === channelLower);
      channelId = channelRow?.id ?? null;
    } catch (_) {}
  }

  // Step 2 — obtain system prompt
  let systemMessage = DEFAULT_SYSTEM_MESSAGE;
  if (ctx.agent_id) {
    try {
      const promptBase = await promptsRepo.findBaseByAgentId(ctx.agent_id);
      const promptByChannel =
        channelId ? await promptsRepo.findByChannelId(ctx.agent_id, channelId) : null;
      const prompt = promptByChannel ?? promptBase;

      if (prompt?.content && String(prompt.content).trim()) {
        systemMessage = prompt.content.trim();
      }
    } catch (err) {
      console.error('[messagePipeline] load prompt error:', err.message);
    }
  }

  // User long-term memory: inject known facts into system prompt
  if (ctx.agent_id && senderId) {
    try {
      const facts = await userMemoryService.getUserFacts(ctx.agent_id, senderId);
      if (facts.length > 0) {
        const factsBlock = facts
          .map((f) => `- ${f.key}: ${f.value}`)
          .join('\n');
        systemMessage = `${systemMessage}\n\nUser known facts:\n${factsBlock}`;
      }
    } catch (err) {
      console.error('[messagePipeline] userMemory getUserFacts error:', err.message);
    }
  }

  // Semantic memory: inject relevant past conversation snippets
  if (ctx.agent_id && senderId) {
    try {
      const relevantMemories = await semanticMemoryService.searchRelevantMemories(
        ctx.agent_id,
        senderId,
        messageText,
        5
      );
      if (relevantMemories.length > 0) {
        const memoryLines = relevantMemories.map(
          (content) => `- user previously said: "${content.slice(0, 300)}${content.length > 300 ? '..."' : ''}"`
        );
        systemMessage = `${systemMessage}\n\nRelevant past conversation memories:\n${memoryLines.join('\n')}`;
      }
    } catch (err) {
      console.error('[messagePipeline] semanticMemory search error:', err.message);
    }
  }

  // Step 3 — generate response (OpenAI with conversation history + AgentCore fallback)
  let replyText = '';
  try {
    const historyLimit = 10;
    const history = await conversationMemoryService.getConversationHistory(
      ctx.agent_id,
      senderId,
      channelId,
      historyLimit
    );

    const messages = [
      { role: 'system', content: systemMessage },
      ...history,
      { role: 'user', content: messageText },
    ];

    replyText = await openaiService.gerarRespostaOpenAI(messageText, { systemMessage, messages });
  } catch (err) {
    console.error('[messagePipeline] OpenAI error, using AgentCore fallback:', err.message);
    try {
      const result = await AgentCore.processMessage(channel, senderId, messageText);
      replyText = result?.reply ?? 'Desculpe, não consegui processar. Tente novamente.';
    } catch (fallbackErr) {
      console.error('[messagePipeline] AgentCore fallback error:', fallbackErr.message);
      replyText = 'Desculpe, ocorreu um erro. Tente novamente em instantes.';
    }
  }

  if (!replyText || typeof replyText !== 'string') {
    replyText = 'Desculpe, não consegui processar sua mensagem.';
  }

  // Step 4 — persist message (incoming + response) when we have an agent
  if (ctx.agent_id) {
    try {
      const conversationId = channelId && senderId ? buildConversationId(channelId, String(senderId)) : null;
      const provider = String(metadata.provider || normalizeChannelType(channelLower) || 'unknown');
      const userMsg = await messagesRepo.create({
        agentId: ctx.agent_id,
        channelId,
        role: 'user',
        content: messageText,
        senderId: senderId ?? null,
        conversationId,
        provider,
        status: 'DELIVERED',
      });
      const assistantMsg = await messagesRepo.create({
        agentId: ctx.agent_id,
        channelId,
        role: 'assistant',
        content: replyText,
        senderId: senderId ?? null,
        conversationId,
        provider,
        status: 'SENT',
      });
      const nowIso = new Date().toISOString();
      if (channelId && senderId) {
        const channelType = normalizeChannelType(channelLower);
        const provider = String(metadata.provider || channelType || 'unknown');
        try {
          if (userMsg?.id) await inboxRepo.updateMessageStatusById(userMsg.id, 'DELIVERED');
          if (assistantMsg?.id) await inboxRepo.updateMessageStatusById(assistantMsg.id, 'SENT');
          if (metadata.tenantId && userMsg?.id) {
            await messageStatusEventsRepo.createStatusEvent({
              messageId: userMsg.id,
              tenantId: metadata.tenantId,
              provider,
              eventType: 'DELIVERED',
              rawPayload: { source: 'pipeline', direction: 'inbound' },
            });
          }
          if (metadata.tenantId && assistantMsg?.id) {
            await messageStatusEventsRepo.createStatusEvent({
              messageId: assistantMsg.id,
              tenantId: metadata.tenantId,
              provider,
              eventType: 'SENT',
              rawPayload: { source: 'pipeline', direction: 'outbound' },
            });
          }
        } catch {
          // não bloquear pipeline por falha de status audit
        }
        emitMessageEvent('message:new', {
          messageId: userMsg?.id,
          channelId,
          channelType,
          conversationId,
          participantId: String(senderId),
          tenantId: metadata.tenantId ?? null,
          contact: String(senderId),
          message: messageText,
          direction: 'inbound',
          timestamp: userMsg?.created_at || nowIso,
          status: 'DELIVERED',
        });
        emitMessageEvent('message:new', {
          messageId: assistantMsg?.id,
          channelId,
          channelType,
          conversationId,
          participantId: String(senderId),
          tenantId: metadata.tenantId ?? null,
          contact: String(senderId),
          message: replyText,
          direction: 'outbound',
          timestamp: nowIso,
          status: 'SENT',
        });
      }

      const conversationText = `User: ${messageText}\nAssistant: ${replyText}`;
      extractAndStoreFacts(ctx.agent_id, senderId, conversationText).catch((err) => {
        console.error('[MEMORY] extraction error', err);
      });

      const contentLen = messageText.length;
      if (
        userMsg?.id &&
        contentLen >= MIN_CONTENT_LENGTH_FOR_EMBEDDING &&
        contentLen <= MAX_CONTENT_LENGTH_FOR_EMBEDDING
      ) {
        semanticMemoryService
          .generateEmbedding(messageText)
          .then((embedding) => {
            if (embedding && embedding.length > 0) {
              return messageEmbeddingsRepo.saveEmbedding({
                messageId: userMsg.id,
                agentId: ctx.agent_id,
                senderId: senderId ?? null,
                content: messageText,
                embedding,
              });
            }
          })
          .catch((err) => {
            console.error('[messagePipeline] embedding save error:', err.message);
          });
      }
    } catch (err) {
      console.error('[messagePipeline] persist error (non-fatal):', err.message);
    }
  }

  // Step 5 — return response text
  return { replyText };
}
