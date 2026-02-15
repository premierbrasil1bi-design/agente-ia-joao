export const API_URL = import.meta.env.VITE_API_URL;

import { AGENT_ID } from '../config/agent.js';

export async function sendMessage(text) {
  const response = await fetch(`${API_URL}/api/agent/message`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      text,
      agent_id: AGENT_ID
    })
  });

  if (!response.ok) {
    throw new Error("Erro ao enviar mensagem");
  }

  return response.json();
}
