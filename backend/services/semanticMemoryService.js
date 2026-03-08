/**
 * Semantic memory – vector search over past conversation snippets.
 * Uses OpenAI embeddings + pgvector for relevance retrieval.
 */

import * as openaiService from './openaiService.js';
import * as messageEmbeddingsRepo from '../repositories/messageEmbeddingsRepository.js';

/**
 * Generate embedding vector for text (OpenAI text-embedding-3-small).
 * @param {string} text
 * @returns {Promise<number[]|null>}
 */
export async function generateEmbedding(text) {
  return openaiService.getEmbedding(text);
}

/**
 * Search for semantically relevant past messages for this agent + sender.
 * Embeds the query, runs vector similarity search, returns content snippets.
 *
 * @param {string} agentId - Agent UUID
 * @param {string} senderId - Channel-specific sender id
 * @param {string} query - Current message or query text
 * @param {number} [limit=5] - Max number of snippets
 * @returns {Promise<string[]>} - Array of content strings (most relevant first)
 */
export async function searchRelevantMemories(agentId, senderId, query, limit = 5) {
  if (!agentId || senderId == null || !query || String(query).trim() === '') {
    return [];
  }
  try {
    const embedding = await generateEmbedding(String(query).trim());
    if (!embedding || embedding.length === 0) {
      return [];
    }
    const rows = await messageEmbeddingsRepo.searchRelevantEmbeddings(
      agentId,
      senderId,
      embedding,
      limit
    );
    return rows
      .map((r) => (r.content != null ? String(r.content).trim() : ''))
      .filter(Boolean);
  } catch (err) {
    console.error('[semanticMemoryService] searchRelevantMemories error:', err.message);
    return [];
  }
}
