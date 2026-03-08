/**
 * User memory service – long-term persistent facts about users.
 * Used by messagePipeline to inject known facts into the system prompt.
 */

import * as userMemoryRepo from '../repositories/userMemoryRepository.js';

/**
 * Get all stored facts for a user (agent + sender), formatted for prompt injection.
 *
 * @param {string} agentId - Agent UUID
 * @param {string} senderId - Channel-specific sender id (e.g. WhatsApp JID)
 * @returns {Promise<Array<{ key: string, value: string }>>}
 */
export async function getUserFacts(agentId, senderId) {
  if (!agentId || senderId == null || String(senderId).trim() === '') {
    return [];
  }

  try {
    const rows = await userMemoryRepo.getFacts(agentId, senderId);
    return rows.map((row) => ({
      key: String(row.memory_key ?? '').trim(),
      value: String(row.memory_value ?? '').trim(),
    })).filter((f) => f.key.length > 0);
  } catch (err) {
    console.error('[userMemoryService] getUserFacts error:', err.message);
    return [];
  }
}
