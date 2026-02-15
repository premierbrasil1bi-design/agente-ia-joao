/**
 * Serviço OpenAI – respostas do agente com contexto e prompt.
 * Aceita systemMessage (instruções do agente). Sem API key retorna fallback (nunca lança).
 */

import OpenAI from 'openai';

const MODEL = 'gpt-4o-mini';

const FALLBACK_SEM_CONFIG =
  'Estou em configuração. Meu responsável ainda está definindo minhas instruções. Em breve estarei pronto para ajudar!';
const FALLBACK_ERRO =
  'Desculpe, não consegui processar sua mensagem no momento. Tente novamente em instantes.';

/**
 * Gera resposta do assistente com opcional system message (contexto/prompt do agente).
 *
 * @param {string} mensagem - Texto enviado pelo usuário
 * @param {{ systemMessage?: string }} [options] - systemMessage = instruções do agente (prompt)
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

  try {
    const openai = new OpenAI({ apiKey });
    const messages = [{ role: 'system', content: systemMessage }, { role: 'user', content: mensagem }];

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
