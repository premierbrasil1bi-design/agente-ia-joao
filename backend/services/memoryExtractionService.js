/**
 * Automatic user memory learning – extract facts from conversations and store in user_memory.
 * Runs non-blocking after assistant reply. Never throws; logs errors.
 */

import * as openaiService from './openaiService.js';
import * as userMemoryRepo from '../repositories/userMemoryRepository.js';

const EXTRACTION_SYSTEM_PROMPT = `You are an information extraction system.
Extract stable facts about the USER from the conversation.
Examples of valid facts:
- name
- city
- language
- preferences
- allergies
- occupation
Return ONLY a JSON array.
Each item must contain:
{
  "key": string,
  "value": string,
  "confidence": number (0-1)
}
If there are no facts return [].`;

const ALLOWED_KEYS = new Set([
  'name', 'nome', 'cidade', 'city', 'language', 'idioma',
  'preference', 'preferencia', 'preferences', 'preferencias',
  'allergy', 'alergia', 'allergies', 'alergias',
  'occupation', 'profissao',
]);

const MAX_VALUE_LENGTH = 200;

function isValidFact(fact) {
  if (!fact || typeof fact !== 'object') return false;
  const key = String(fact.key ?? '').trim().toLowerCase();
  const value = String(fact.value ?? '').trim();
  if (key.length === 0 || value.length === 0) return false;
  if (value.length > MAX_VALUE_LENGTH) return false;
  if (!ALLOWED_KEYS.has(key)) return false;
  return true;
}

/**
 * Extract user facts from conversation text via OpenAI and store them in user_memory.
 * Non-blocking: wrap in try/catch, log errors, never throw.
 *
 * @param {string} agentId - Agent UUID
 * @param {string} senderId - Channel-specific sender id
 * @param {string} conversationText - e.g. "User: ...\nAssistant: ..."
 */
export async function extractAndStoreFacts(agentId, senderId, conversationText) {
  try {
    if (!agentId || senderId == null || String(conversationText ?? '').trim() === '') {
      return;
    }

    const conversationInput = `Conversation:\n${String(conversationText).trim()}`;
    const response = await openaiService.gerarRespostaOpenAI(conversationInput, {
      systemMessage: EXTRACTION_SYSTEM_PROMPT,
    });

    if (!response || typeof response !== 'string') {
      return;
    }

    const trimmed = response.trim();
    const start = trimmed.indexOf('[');
    const end = trimmed.lastIndexOf(']');
    if (start === -1 || end === -1 || end <= start) return;
    const jsonStr = trimmed.slice(start, end + 1);
    let arr;
    try {
      arr = JSON.parse(jsonStr);
    } catch {
      return;
    }

    if (!Array.isArray(arr) || arr.length === 0) {
      return;
    }

    const facts = arr.filter((f) => isValidFact(f)).map((f) => ({
      key: String(f.key).trim().toLowerCase(),
      value: String(f.value).trim().slice(0, MAX_VALUE_LENGTH),
      confidence: typeof f.confidence === 'number' && f.confidence >= 0 && f.confidence <= 1
        ? f.confidence
        : 0.6,
    }));

    if (facts.length === 0) {
      return;
    }

    console.log('[MEMORY] facts extracted:', facts);

    for (const fact of facts) {
      try {
        await userMemoryRepo.storeFact(
          agentId,
          senderId,
          fact.key,
          fact.value,
          fact.confidence
        );
        console.log('[MEMORY] stored fact:', fact.key, fact.value);
      } catch (storeErr) {
        console.error('[MEMORY] storeFact error:', storeErr.message);
      }
    }
  } catch (err) {
    console.error('[MEMORY] extraction error', err);
  }
}
