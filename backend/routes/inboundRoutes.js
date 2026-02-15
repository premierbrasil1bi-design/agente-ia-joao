/**
 * Rotas de entrada de mensagens – canal WEB e futuros (WhatsApp, API).
 * Usa contexto + prompt do agente; fallback seguro quando não houver prompt (nunca 500).
 */

import { Router } from 'express';
import { isConnected } from '../db/connection.js';
import { gerarRespostaOpenAI } from '../services/openaiService.js';
import * as usageLogsRepo from '../repositories/usageLogsRepository.js';
import * as contextService from '../services/contextService.js';
import * as promptsRepo from '../repositories/promptsRepository.js';

const router = Router();

const FALLBACK_SEM_AGENTE =
  'Para conversar com um agente, informe o agent_id (query, body ou header x-agent-id).';
const FALLBACK_EM_CONFIGURACAO =
  'Estou em configuração. Meu responsável ainda está definindo minhas instruções. Em breve estarei pronto para ajudar!';

// GET /message — página amigável (envio é POST)
router.get('/message', (req, res) => {
  res.status(200).set('Content-Type', 'text/html; charset=utf-8').send(`
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Agente Omni-Channel</title></head>
<body style="font-family:sans-serif;max-width:500px;margin:2rem auto;padding:1rem;">
  <h1>Endpoint de mensagens</h1>
  <p>Esta URL aceita apenas <strong>POST</strong> com corpo JSON.</p>
  <p>Para conversar com o agente, use o <strong>chat na página</strong> do seu site ou envie:</p>
  <pre style="background:#f0f0f0;padding:1rem;border-radius:4px;">POST ${req.protocol}://${req.get('host')}/api/agent/message
Content-Type: application/json

{ "text": "sua mensagem", "agent_id": "uuid-do-agente" }</pre>
  <p><a href="/health">Verificar saúde do backend</a></p>
</body>
</html>`);
});

/**
 * POST /message — usa req.context (agent_id, client_id, channel).
 * Carrega contexto + prompt do agente; responde com fallback seguro (sempre 200).
 */
router.post('/message', async (req, res) => {
  const { text, mensagem } = req.body ?? {};
  const conteudo =
    (typeof text === 'string' && text.trim())
      ? text.trim()
      : (typeof mensagem === 'string' && mensagem.trim())
        ? mensagem.trim()
        : '';

  if (!conteudo) {
    return res.status(400).json({
      error: "O corpo deve conter 'text' ou 'mensagem' (string não vazia)."
    });
  }

  const channel = req.context?.channel ?? 'WEB';
  const clientId = req.context?.client_id ?? null;
  const agentId = req.context?.agent_id ?? null;

  let systemMessage = null;
  try {
    if (agentId) {
      const ctx = await contextService.getContext(clientId, agentId, channel.toLowerCase());
      if (ctx.prompt_id) {
        const prompt = await promptsRepo.findById(ctx.prompt_id);
        if (prompt?.content) systemMessage = prompt.content;
      }
      if (!systemMessage) {
        const promptBase = await promptsRepo.findBaseByAgentId(agentId);
        if (promptBase?.content) systemMessage = promptBase.content;
      }
    }
  } catch (err) {
    // ignora erro de banco; usamos fallback do openaiService
  }

  let finalResponse;
  if (!agentId) {
    finalResponse = FALLBACK_SEM_AGENTE;
  } else if (!systemMessage) {
    finalResponse = FALLBACK_EM_CONFIGURACAO;
  } else {
    finalResponse = await gerarRespostaOpenAI(conteudo, { systemMessage });
  }

  if (isConnected() && agentId) {
    try {
      await usageLogsRepo.create({
        clientId,
        agentId,
        channelId: null,
        channelType: channel,
        messagesSent: 1,
        messagesReceived: 1,
        tokens: 0,
        estimatedCost: 0,
      });
    } catch (logErr) {
      // não falha a resposta
    }
  }

  res.set('x-channel-active', channel);
  res.status(200).json({ channel, response: finalResponse });
});

export default router;