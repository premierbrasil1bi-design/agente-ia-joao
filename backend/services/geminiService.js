// =============================================================================
// DESATIVADO - GEMINI - NÃO USAR
// Integração substituída por OpenAI (openaiService.js).
// Código mantido apenas como histórico/referência.
// =============================================================================

/*
import fetch from "node-fetch";

export async function gerarRespostaGemini(mensagem) {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash";

  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY não definida no .env");
  }

  const url = `https://generativelanguage.googleapis.com/v1/models/${GEMINI_MODEL}:generateContent`;

  const requestBody = {
    contents: [
      {
        parts: [{ text: mensagem }]
      }
    ]
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": GEMINI_API_KEY
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
      throw new Error(`Erro na API do Gemini: ${errorText}`);
  }

  const data = await response.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
}
*/

// Stub para evitar que algum import acidental quebre; não usa Gemini.
export async function gerarRespostaGemini(_mensagem) {
  throw new Error('Gemini desativado. Use openaiService.gerarRespostaOpenAI.');
}
