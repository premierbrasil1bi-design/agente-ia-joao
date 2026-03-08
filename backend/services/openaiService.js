/**
 * Serviço OpenAI – respostas do agente com contexto e prompt.
 * Aceita systemMessage (instruções do agente). Sem API key retorna fallback (nunca lança).
 */

import OpenAI from 'openai';

const MODEL = 'gpt-4o-mini';
const EMBEDDING_MODEL = 'text-embedding-3-small';

const FALLBACK_SEM_CONFIG =
  'Estou em configuração. Meu responsável ainda está definindo minhas instruções. Em breve estarei pronto para ajudar!';
const FALLBACK_ERRO =
  'Desculpe, não consegui processar sua mensagem no momento. Tente novamente em instantes.';

/**
 * Gera resposta do assistente com opcional system message e histórico de conversa.
 *
 * @param {string} mensagem - Texto enviado pelo usuário
 * @param {{ systemMessage?: string, messages?: Array<{ role: string, content: string }> }} [options]
 *   - systemMessage = instruções do agente (prompt)
 *   - messages = array completo para a API (system + history + user); quando presente, mensagem atual deve ser a última
 * @returns {Promise<string>} - Texto da resposta ou mensagem de fallback (nunca lança)
 */
export async function gerarRespostaOpenAI(mensagem, options = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return FALLBACK_SEM_CONFIG;
  }

  const systemMessage =
    options.systemMessage && String(options.systemMessage).trim()
      ? options.systemMessage.trim()
      : 'Você é um assistente prestativo. Responda em português de forma clara e objetiva.';

  let messages;
  if (Array.isArray(options.messages) && options.messages.length > 0) {
    messages = options.messages;
  } else {
    messages = [{ role: 'system', content: systemMessage }, { role: 'user', content: mensagem }];
  }

  try {
    const openai = new OpenAI({ apiKey });

    const chatCompletion = await openai.chat.completions.create({
      model: MODEL,
      messages,
    });

    const text = chatCompletion.choices?.[0]?.message?.content?.trim() ?? '';
    return text || FALLBACK_ERRO;
  } catch (err) {
    return FALLBACK_ERRO;
  }
}

/**
 * Gera embedding para um texto (OpenAI text-embedding-3-small, 1536 dims).
 * Usado para memória semântica / busca vetorial.
 *
 * @param {string} text - Texto a ser embedado
 * @returns {Promise<number[]|null>} - Array de 1536 floats ou null em erro
 */
export async function getEmbedding(text) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !text || typeof text !== 'string') {
    return null;
  }
  const trimmed = String(text).trim().slice(0, 8000);
  if (!trimmed) return null;
  try {
    const openai = new OpenAI({ apiKey });
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: trimmed,
    });
    const embedding = response?.data?.[0]?.embedding;
    return Array.isArray(embedding) ? embedding : null;
  } catch (err) {
    console.error('[openaiService] getEmbedding error:', err.message);
    return null;
  }
}
