/**
 * Conversation memory – loads recent messages for a conversation and formats them
 * for OpenAI (chat history). Used by messagePipeline to inject context into the AI prompt.
 */

import * as messagesRepo from '../repositories/messagesRepository.js';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

/**
 * Get conversation history for a given agent + sender (+ optional channel).
 * Returns messages in chronological order (oldest first) in OpenAI chat format.
 *
 * @param {string} agentId - Agent UUID
 * @param {string} senderId - Channel-specific sender id (e.g. WhatsApp JID)
 * @param {string|null} [channelId] - Optional channel UUID (filters by channel when provided)
 * @param {number} [limit=10] - Max number of messages to return (capped at 50)
 * @returns {Promise<Array<{ role: 'user'|'assistant', content: string }>>}
 */
export async function getConversationHistory(agentId, senderId, channelId = null, limit = DEFAULT_LIMIT) {
  if (!agentId || senderId == null || String(senderId).trim() === '') {
    return [];
  }

  const cappedLimit = Math.min(Math.max(1, limit), MAX_LIMIT);

  try {
    const rows = await messagesRepo.findRecentForConversation(
      agentId,
      channelId,
      senderId,
      cappedLimit
    );

    const inChronologicalOrder = [...rows].reverse();

    return inChronologicalOrder
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role,
        content: String(m.content ?? '').trim() || '(mensagem vazia)',
      }));
  } catch (err) {
    console.error('[conversationMemory] getConversationHistory error:', err.message);
    return [];
  }
}
